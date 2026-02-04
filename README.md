# Playwright E2E Automation

This project demonstrates end-to-end (E2E) testing using **Playwright**, **TypeScript**, and **Yarn**, with optional **Docker support**. It includes a **Page Object Model (POM)** structure and a sample login test.

## Prerequisites

- [Node.js](https://nodejs.org/) (v14 or later)
- [Yarn](https://yarnpkg.com/) (v1.22 or later)
- [Docker](https://www.docker.com/) (optional, for containerized testing)
- [Playwright](https://playwright.dev/) (installed via Yarn)

## Installation

1. Clone the repository:
    ```bash
    git clone https://github.com/your-username/playwright-ts.git
    cd playwright-ts
    ```
2. Install dependencies using Yarn:
    ```bash
    yarn install
    ```
3. Install Playwright browsers:
    ```bash
    npx playwright install
    ```

## Running Tests

You can run tests using Yarn or Docker.

### Using Yarn

To run tests locally, use the following command:

```bash
yarn test
```

To run tests in headed mode (with browser UI), use:

```bash
yarn test:headed
```

### Using Docker

To run tests in a Docker container, build the Docker image and run the container:

```bash
docker build -t playwright-ts -f docker/Dockerfile .
docker run playwright-ts
```
