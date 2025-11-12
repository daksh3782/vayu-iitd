name: Netlify Rebuild and Data Fetch

on:
  schedule:
    - cron: '*/5 * * * *'
  workflow_dispatch:

jobs:
  rebuild:
    runs-on: ubuntu-latest
    
    steps:
      - name: Checkout repository
        uses: actions/checkout@v4

      - name: Set up Node.js
        uses: actions/setup-node@v4
        with:
          node-version: '18'

      - name: Install dependencies
        run: npm install

      # ==========================================================
      #  THIS IS THE CRITICAL CHANGE
      #  It passes your new API key (stored as a secret)
      #  into the script as an environment variable.
      # ==========================================================
      - name: Run build script (build-data.js)
        env:
          FIREBASE_API_KEY: ${{ secrets.FIREBASE_API_KEY }}
        run: npm run build

      - name: Commit new data files
        run: |
          git config --global user.name 'GitHub Actions Bot'
          git config --global user.email 'actions-bot@github.com'
          git add -A
          
          if ! git diff --staged --quiet; then
            git commit -m "📈 [BOT] Auto-refresh VAYU data"
            git push
          else
            echo "No data changes. No commit needed."
          fi
