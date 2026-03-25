#!/bin/bash
set -e

# Load env vars
if [ -f /workspaces/bdralph/.devcontainer/.env ]; then
  set -a
  source /workspaces/bdralph/.devcontainer/.env
  set +a
  echo 'set -a; source /workspaces/bdralph/.devcontainer/.env; set +a' >> ~/.bashrc
fi

# Install dependencies
npm install

# Install Claude Code
curl -fsSL https://claude.ai/install.sh | bash || true

# Add Claude Code to PATH
echo 'export PATH="$HOME/.local/bin:$PATH"' >> ~/.bashrc
export PATH="$HOME/.local/bin:$PATH"

# Configure git hooks
git config core.hooksPath .githooks

# GitHub CLI auth
if [ -n "$GITHUB_TOKEN" ]; then
  echo "$GITHUB_TOKEN" | gh auth login --with-token 2>/dev/null || true
fi

# Git identity
if [ -n "$GIT_USER_EMAIL" ]; then
  git config --global user.email "$GIT_USER_EMAIL"
fi
if [ -n "$GIT_USER_NAME" ]; then
  git config --global user.name "$GIT_USER_NAME"
fi

echo "Setup complete."