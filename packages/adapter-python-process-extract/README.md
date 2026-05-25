# pkit-process-extract

Python adapter for pipeline-kit that mirrors the `@idriszade/process-extract` TS package. Provides LLM-powered structured data extraction using Pydantic schemas.

## Installation

```bash
pip install pkit-process-extract[anthropic]   # Anthropic Claude
pip install pkit-process-extract[openai]      # OpenAI GPT
pip install pkit-process-extract[google]      # Google Gemini
pip install pkit-process-extract[all]         # All providers
```

## Usage

```python
from pydantic import BaseModel
from pkit_process_extract import create_extract_process, ExtractProcessConfig

class Person(BaseModel):
    name: str
    age: int
    email: str | None = None

config = ExtractProcessConfig(
    provider="anthropic",
    model="claude-3-5-haiku-latest",
    prompt="Extract person details from: {input}",
    output_schema=Person,
    # api_key defaults to ANTHROPIC_API_KEY env var
)

process = create_extract_process(config)
result = await process.run("John Doe, 30, john@example.com")

if result.ok:
    person = result.value  # Person instance
else:
    print(result.error.code, result.error.message)
```

## Configuration

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `provider` | `"anthropic" \| "openai" \| "google"` | required | LLM provider |
| `model` | `str` | required | Model identifier |
| `prompt` | `str` | required | Prompt template; `{input}` is replaced with the input value |
| `output_schema` | `Type[BaseModel]` | required | Pydantic model for output |
| `api_key` | `str \| None` | env var | Provider API key |
| `temperature` | `float` | `0.0` | Sampling temperature |
| `max_retries_on_schema_failure` | `int` | `2` | Retries on Pydantic validation error |
| `system_prompt` | `str \| None` | `None` | Optional system prompt |

## Error codes

- `schema_validation_failed` — Pydantic validation failed after all retries
- `provider_not_installed` — optional provider SDK not installed
- `api_error` — provider API returned an error
- `auth_failed` — invalid or missing API key
- `rate_limited` — provider rate limit hit
- `network_error` — connection/timeout issue
