"""Native-session task adapters, intentionally without a paid transport."""
from .claude import render as claude_prompt
from .codex import render as codex_prompt


def render(provider: str, task: dict) -> str:
    if provider == "claude":
        return claude_prompt(task)
    if provider == "codex":
        return codex_prompt(task)
    raise ValueError(f"Unsupported provider: {provider}")
