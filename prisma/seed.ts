// Demo seed: 4 fixed accounts, each with one face template and a valid pass for
// today. Uses the codec to store templates in the exact persisted form the app
// expects. Requirements 3.2 (fixed demo population), 8.6, 10.5 wiring done elsewhere.
import { PrismaClient } from "@prisma/client";
import { encodeTemplate } from "../src/lib/codec/encode";
import { personVector } from "../src/lib/face/demoVectors";
import { CURRENT_MODEL_VERSION } from "../src/types/vector";

const prisma = new PrismaClient();

function businessDayEnd(now = new Date()): Date {
  const d = new Date(now);
  d.setHours(23, 59, 59, 999);
  return d;
}

const DEMO = [
  { name: "Aoi", balance: 3000 },
  { name: "Ren", balance: 500 },
  { name: "Yui", balance: 10000 },
  { name: "Sora", balance: 0 },
];

async function main() {
  // Clean slate for a repeatable demo.
  await prisma.auditLog.deleteMany();
  await prisma.pass.deleteMany();
  await prisma.session.deleteMany();
  await prisma.faceTemplate.deleteMany();
  await prisma.account.deleteMany();

  const expiresAt = businessDayEnd();

  for (let i = 0; i < DEMO.length; i++) {
    const person = DEMO[i];
    const account = await prisma.account.create({
      data: {
        balance: person.balance,
        retentionDays: 7,
        consentEnrollment: true,
        consentPayment: true,
        consentTs: new Date(),
        consentVersion: "v1",
      },
    });

    const vector = personVector(i);
    await prisma.faceTemplate.create({
      data: {
        accountId: account.id,
        vector: encodeTemplate(vector, CURRENT_MODEL_VERSION),
        modelVersion: CURRENT_MODEL_VERSION,
      },
    });

    // Valid bathing ticket / use-right for today.
    await prisma.pass.create({
      data: { accountId: account.id, status: "VALID", expiresAt },
    });

    console.log(`seeded ${person.name} -> ${account.id} (person index ${i}, balance ${person.balance})`);
  }
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
