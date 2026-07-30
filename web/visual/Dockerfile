# Browsers live here and only here — nothing Playwright-related is installed on
# the host. Image tag must stay pinned to the same version as package.json's
# @playwright/test, or the runner refuses the bundled browsers.
FROM mcr.microsoft.com/playwright:v1.62.0-noble

WORKDIR /harness

# Deps bake into the image at build. Specs + baselines bind-mount to
# /harness/visual at run time, where node resolution walks up to these.
COPY package.json ./
RUN npm install --no-audit --no-fund

ENV CI=1
ENTRYPOINT ["npx", "playwright", "test", "--config", "visual/playwright.config.ts"]
