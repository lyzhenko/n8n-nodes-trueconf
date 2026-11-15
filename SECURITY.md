# Security policy

## Supported versions

Only the latest published version of `n8n-nodes-trueconf` receives security fixes.

## Reporting a vulnerability

Please do not open a public issue for security problems. Report them privately:

* GitHub: **Security → Report a vulnerability** in this repository, or
* email the maintainer listed in `package.json`.

Include the version, the n8n and TrueConf Server versions, and reproduction steps.
You can expect an initial response within a few days.

## Scope and credentials

The node authenticates to TrueConf as a chatbot user. Credentials are stored by n8n in encrypted
form (n8n `N8N_ENCRYPTION_KEY`) and are never written to logs by this package. When reporting an
issue, do not include real bot passwords, JWT tokens or chat contents.
