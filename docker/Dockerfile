FROM mcr.microsoft.com/playwright:v1.42.0-jammy

WORKDIR /app

# Copy Yarn files
COPY package.json yarn.lock ./

# Install dependencies
RUN yarn install --frozen-lockfile

# Copy project files
COPY . .

# Install Playwright browsers
RUN npx playwright install --with-deps

# Run tests headless
CMD ["yarn", "test"]
