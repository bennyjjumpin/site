# Personal site

Static site, no build step. Deploys on Cloudflare Pages.

## Run locally
    python3 -m http.server 8000
Then open http://localhost:8000

## Deploy on Cloudflare Pages
1. Push this folder to a GitHub repo.
2. Cloudflare dashboard → Workers & Pages → Create → Pages → Connect to Git.
3. Pick the repo. Framework preset: None. Build command: (leave empty). Output directory: /
4. Every push to main redeploys automatically.

## To fill in
- Replace every `[Last Name]`, `YOUR-USERNAME`, `YOUR-PROFILE`, `you@example.com`, and other [bracketed] placeholders.
- Add `resume.pdf` to the root.
- Replace the placeholder in `chess/index.html` once the WebAssembly engine is built.
