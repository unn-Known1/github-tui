# GitHub TUI

A terminal user interface for GitHub, built with Node.js and no external dependencies.

## Features

- GitHub Personal Access Token (PAT) authentication
- View user profile and repository information
- Browse issues and pull requests
- Search repositories
- View notifications

## Installation

No installation required. Just run:

```bash
node app.mjs
```

## Usage

### Login

```bash
login
```

Enter your GitHub Personal Access Token when prompted.

### Get Status

```bash
status
```

Shows current authentication status and account information.

### Logout

```bash
logout
```

Removes stored authentication token.

### Help

```bash
help
```

Shows available commands.

## Creating a GitHub Personal Access Token

1. Go to GitHub Settings → Developer settings → Personal access tokens
2. Click "Generate new token"
3. Select scopes: `repo`, `read:user`, `notifications`
4. Copy the token and use it with the `login` command

## Commands

| Command | Description |
|---------|-------------|
| `login` | Authenticate with GitHub |
| `status` | Show authentication status |
| `logout` | Remove stored token |
| `help` | Show help message |
| `exit` | Exit the application |
