# HOLLOW//30 — upload your game to GitHub

The game is still named HOLLOW//30. The GitHub repo can be called hollow-30 or hollow-31.

1. Extract HOLLOW30-GitHub-Upload.zip on a computer.
2. Open https://github.com/iinvuce/hollow-30 .
3. Select **Add file > Upload files** (if the repository is blank, choose **uploading an existing file**).
4. Drag **all files and folders INSIDE** the extracted HOLLOW30-GitHub-Upload folder onto the upload area. This includes server/, shared/, data/, index.html, package.json, and render.yaml.
5. Click **Commit changes**.
6. Return to ChatGPT and say **Uploaded** to continue with Render hosting.

Do not upload the .zip itself: GitHub cannot run it as your source tree.

Deployment uses Render's free web-service tier for testing. It supports live co-op/WebSocket multiplayer, subject to plan limits and inactivity sleeping. The SQLite database and saved progress may be erased on restarts/redeploys. Use paid hosting with persistent disk for durable player accounts/progress, and review any charges before opting in.
