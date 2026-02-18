# IdpCore Advanced Docs

This site uses **Docusaurus + Redocusaurus**.

## Local usage

From repository root:

```bash
npm run docs:site:install
npm run docs:dev
```

`docs:dev` does two things:

1. Generates OpenAPI + reference pages from source code.
2. Starts Docusaurus on `http://localhost:4010`.

## Build

```bash
npm run docs:generate
npm run docs:site:build
npm run docs:site:serve
```
