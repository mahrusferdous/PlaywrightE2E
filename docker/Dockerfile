FROM mcr.microsoft.com/playwright:v1.42.0-jammy

WORKDIR /app

COPY package.json yarn.lock ./
RUN yarn install --frozen-lockfile

COPY . .

RUN npx playwright install --with-deps

ENV PWHEADLESS=true

CMD ["yarn", "test"]
