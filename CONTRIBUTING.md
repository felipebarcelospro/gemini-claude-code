# Contributing to Gemini Claude Code

Thank you for your interest in contributing to **Gemini Claude Code**! This project aims to bridge the gap between Google's Gemini models and Anthropic's Claude Code CLI.

By contributing to this open-source project, you help make AI tools more interoperable and accessible.

## Development Setup

We use [Bun](https://bun.sh/) as our runtime and package manager for its high performance and built-in TypeScript support.

1. **Clone the repository**:
   ```bash
   git clone https://github.com/felipebarcelospro/gemini-claude-code.git
   cd gemini-claude-code
   ```

2. **Install dependencies**:
   ```bash
   bun install
   ```

3. **Start the development server (Watch mode)**:
   ```bash
   bun run dev
   ```

## Development Commands

- `bun test`: Run the test suite. We use Bun's built-in test runner.
- `bun run typecheck`: Run TypeScript type checking.
- `bun run build`: Build the project for production into the `dist` folder.

## AI-Assisted Development

If you are using Claude Code or another AI coding assistant to contribute to this project, please note that we have a `CLAUDE.md` file in the root directory.

The `CLAUDE.md` file contains architectural guidelines, specific rules, and structural information that AI assistants should follow when modifying this codebase.

## Submitting Changes

1. **Create a new branch**: `git checkout -b feature/your-feature-name` or `fix/your-fix-name`.
2. **Make your changes**: Ensure your code follows the existing style and passes all tests.
3. **Write tests**: If you are adding a new feature or fixing a bug, please add corresponding tests in the `tests/` directory.
4. **Run checks**: Verify everything works by running `bun run typecheck` and `bun test`.
5. **Commit your changes**: Write clear, concise commit messages.
6. **Push to your fork/branch** and submit a **Pull Request**.

## Issue Reports

If you find a bug or have a feature request, please use the issue templates provided in the repository to submit your report.

Thank you for contributing!
