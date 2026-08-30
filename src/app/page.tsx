export default function Home() {
  return (
    <main style={{ fontFamily: "system-ui", padding: "2rem", lineHeight: 1.7 }}>
      <h1>顔認証温泉入場・前払い決済システム</h1>
      <p>端末UI（terminals）:</p>
      <ul>
        <li>
          <a href="/enroll">登録端末 (Enrollment)</a>
        </li>
        <li>
          <a href="/entry">入場ゲート (Entry)</a>
        </li>
        <li>
          <a href="/service">施設内窓口 (Service)</a>
        </li>
        <li>
          <a href="/exit">退場ゲート (Exit)</a>
        </li>
        <li>
          <a href="/admin">管理コンソール (Admin)</a>
        </li>
      </ul>
    </main>
  );
}
