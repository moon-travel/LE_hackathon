# face-api.js model weights

Place the following weight files here (served at `/models/*`). They are loaded by
`src/lib/face/loadModels.ts`:

- `tiny_face_detector_model-weights_manifest.json` + shard(s)
- `face_landmark_68_model-weights_manifest.json` + shard(s)
- `face_recognition_model-weights_manifest.json` + shard(s)

Fetch them from the face-api.js repo `weights/` folder:

```bash
BASE=https://raw.githubusercontent.com/justadudewhohacks/face-api.js/master/weights
for f in \
  tiny_face_detector_model-weights_manifest.json \
  tiny_face_detector_model-shard1 \
  face_landmark_68_model-weights_manifest.json \
  face_landmark_68_model-shard1 \
  face_recognition_model-weights_manifest.json \
  face_recognition_model-shard1 \
  face_recognition_model-shard2 ; do
  curl -sSL "$BASE/$f" -o "public/models/$f"
done
```

These are ~6.5 MB total and are not committed to the repo.
