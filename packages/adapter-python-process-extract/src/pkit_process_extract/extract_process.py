"""extract_process — Pydantic-based port of process-extract TS adapter.

Mirrors @idriszade/process-extract: LLM-powered structured data extraction
with schema validation and retry-on-failure loop.

ADR IX-1 wire protocol is NOT used here — this is a direct Python library
(not a subprocess adapter). The caller invokes .run(input) directly.
"""

from __future__ import annotations

import json
import os
from dataclasses import dataclass, field
from typing import Any, Generic, Literal, Type, TypeVar

from pydantic import BaseModel, ValidationError

_O = TypeVar("_O", bound=BaseModel)


class ExtractProcessConfig(BaseModel, Generic[_O]):
    """Configuration for create_extract_process.

    Mirrors ExtractProcessConfig<I, O> from TS but simplified for Python:
    - provider names match TS ("anthropic" | "openai" | "google" vs "gemini" in TS)
    - prompt is a plain string; pass {input} placeholder to inject the input value
    - output_schema is a Pydantic model class (not Zod type)
    """

    provider: Literal["anthropic", "openai", "google"]
    model: str
    prompt: str
    output_schema: Type[BaseModel]
    api_key: str | None = None
    temperature: float = 0.0
    max_retries_on_schema_failure: int = 2
    system_prompt: str | None = None

    model_config = {"arbitrary_types_allowed": True}


@dataclass
class ProcessError:
    """Error envelope returned when extraction fails."""

    code: str  # "schema_validation_failed" | "provider_not_installed" | "api_error" | ...
    message: str
    cause: Exception | None = field(default=None, repr=False)


@dataclass
class ProcessResult(Generic[_O]):
    """Result discriminant: ok=True means value is set; ok=False means error is set."""

    ok: bool
    value: _O | None = None
    error: ProcessError | None = None


def _resolve_api_key(provider: str, config_key: str | None) -> str | None:
    """Fall back to env vars if no explicit key provided (mirrors TS resolveApiKey)."""
    if config_key:
        return config_key
    env_map = {
        "anthropic": "ANTHROPIC_API_KEY",
        "openai": "OPENAI_API_KEY",
        "google": "GEMINI_API_KEY",
    }
    env_var = env_map.get(provider)
    if env_var:
        return os.environ.get(env_var) or os.environ.get("GOOGLE_API_KEY")
    return None


def _import_anthropic() -> Any:
    """Lazy import Anthropic SDK with a helpful error if not installed."""
    try:
        from anthropic import Anthropic  # type: ignore[import-untyped]

        return Anthropic
    except ImportError as exc:
        raise RuntimeError(
            "anthropic package not installed. "
            "pip install pkit-process-extract[anthropic]"
        ) from exc


def _import_openai() -> Any:
    """Lazy import OpenAI SDK with a helpful error if not installed."""
    try:
        from openai import OpenAI  # type: ignore[import-untyped]

        return OpenAI
    except ImportError as exc:
        raise RuntimeError(
            "openai package not installed. "
            "pip install pkit-process-extract[openai]"
        ) from exc


def _import_google() -> Any:
    """Lazy import Google Generative AI SDK with a helpful error if not installed."""
    try:
        import google.generativeai as genai  # type: ignore[import-untyped]

        return genai
    except ImportError as exc:
        raise RuntimeError(
            "google-generativeai package not installed. "
            "pip install pkit-process-extract[google]"
        ) from exc


def _call_anthropic(
    model: str,
    api_key: str | None,
    system_prompt: str | None,
    prompt_str: str,
    json_schema: dict[str, Any],
    temperature: float,
) -> Any:
    """Call Anthropic API and return parsed JSON dict."""
    Anthropic = _import_anthropic()
    client = Anthropic(api_key=api_key) if api_key else Anthropic()

    messages: list[dict[str, Any]] = [{"role": "user", "content": prompt_str}]

    kwargs: dict[str, Any] = {
        "model": model,
        "max_tokens": 4096,
        "messages": messages,
        "tools": [
            {
                "name": "extract_data",
                "description": "Extract structured data matching the schema",
                "input_schema": json_schema,
            }
        ],
        "tool_choice": {"type": "tool", "name": "extract_data"},
    }
    if system_prompt:
        kwargs["system"] = system_prompt

    response = client.messages.create(**kwargs)
    # Find tool use block
    for block in response.content:
        if hasattr(block, "type") and block.type == "tool_use":
            return block.input
    raise ValueError("Anthropic response did not contain tool_use block")


def _call_openai(
    model: str,
    api_key: str | None,
    system_prompt: str | None,
    prompt_str: str,
    json_schema: dict[str, Any],
    temperature: float,
) -> Any:
    """Call OpenAI API and return parsed JSON dict."""
    OpenAI = _import_openai()
    client = OpenAI(api_key=api_key) if api_key else OpenAI()

    messages: list[dict[str, Any]] = []
    if system_prompt:
        messages.append({"role": "system", "content": system_prompt})
    messages.append({"role": "user", "content": prompt_str})

    response = client.chat.completions.create(
        model=model,
        messages=messages,
        temperature=temperature,
        response_format={
            "type": "json_schema",
            "json_schema": {"name": "extract_output", "schema": json_schema, "strict": True},
        },
    )
    content = response.choices[0].message.content
    if content is None:
        raise ValueError("OpenAI returned null content (likely content filter)")
    return json.loads(content)


def _call_google(
    model: str,
    api_key: str | None,
    system_prompt: str | None,
    prompt_str: str,
    json_schema: dict[str, Any],
    temperature: float,
) -> Any:
    """Call Google Generative AI API and return parsed JSON dict."""
    genai = _import_google()

    if api_key:
        genai.configure(api_key=api_key)

    generation_config: dict[str, Any] = {
        "temperature": temperature,
        "response_mime_type": "application/json",
        "response_schema": json_schema,
    }

    model_kwargs: dict[str, Any] = {}
    if system_prompt:
        model_kwargs["system_instruction"] = system_prompt

    g_model = genai.GenerativeModel(model, **model_kwargs)
    response = g_model.generate_content(prompt_str, generation_config=generation_config)
    return json.loads(response.text)


def _map_provider_error(exc: Exception, provider: str) -> ProcessError:
    """Map a provider exception to a ProcessError with actionable code."""
    msg = str(exc)
    status: int | None = getattr(exc, "status_code", getattr(exc, "status", None))

    if "not installed" in msg and "pip install" in msg:
        return ProcessError(code="provider_not_installed", message=msg, cause=exc)

    if status == 401 or any(k in msg.lower() for k in ("auth", "api key", "unauthorized")):
        return ProcessError(code="auth_failed", message=msg, cause=exc)

    if status == 429 or any(k in msg.lower() for k in ("rate", "quota", "429")):
        return ProcessError(code="rate_limited", message=msg, cause=exc)

    if any(k in msg.lower() for k in ("network", "econnrefused", "etimedout", "timeout")):
        return ProcessError(code="network_error", message=msg, cause=exc)

    if status is not None and 400 <= status < 500:
        return ProcessError(code="api_error", message=msg, cause=exc)

    return ProcessError(code="api_error", message=msg, cause=exc)


class _ExtractProcess(Generic[_O]):
    """Callable process object returned by create_extract_process."""

    def __init__(self, config: ExtractProcessConfig[_O]) -> None:
        self._config = config
        self._max_retries = config.max_retries_on_schema_failure

    async def run(self, input_value: Any) -> ProcessResult[_O]:
        """Run extraction against the configured provider, retrying on schema failure."""
        config = self._config
        prompt_str = config.prompt.replace("{input}", str(input_value))
        json_schema = config.output_schema.model_json_schema()
        api_key = _resolve_api_key(config.provider, config.api_key)

        last_parse_error = ""

        for attempt in range(self._max_retries + 1):
            if attempt > 0:
                prompt_str = (
                    f"{config.prompt.replace('{input}', str(input_value))}\n\n"
                    f"Your last response failed schema validation: {last_parse_error}. "
                    f"Output valid JSON matching: {json.dumps(json_schema)}"
                )

            try:
                raw_data = self._call_provider(
                    api_key=api_key,
                    prompt_str=prompt_str,
                    json_schema=json_schema,
                )
            except RuntimeError as exc:
                # Provider not installed
                return ProcessResult(
                    ok=False,
                    error=ProcessError(
                        code="provider_not_installed",
                        message=str(exc),
                        cause=exc,
                    ),
                )
            except Exception as exc:
                return ProcessResult(
                    ok=False,
                    error=_map_provider_error(exc, config.provider),
                )

            try:
                validated = config.output_schema.model_validate(raw_data)
                return ProcessResult(ok=True, value=validated)
            except ValidationError as exc:
                last_parse_error = str(exc)

        return ProcessResult(
            ok=False,
            error=ProcessError(
                code="schema_validation_failed",
                message=(
                    f"Schema validation failed after {self._max_retries + 1} attempts: "
                    f"{last_parse_error}"
                ),
            ),
        )

    def _call_provider(
        self,
        api_key: str | None,
        prompt_str: str,
        json_schema: dict[str, Any],
    ) -> Any:
        config = self._config
        if config.provider == "anthropic":
            return _call_anthropic(
                model=config.model,
                api_key=api_key,
                system_prompt=config.system_prompt,
                prompt_str=prompt_str,
                json_schema=json_schema,
                temperature=config.temperature,
            )
        if config.provider == "openai":
            return _call_openai(
                model=config.model,
                api_key=api_key,
                system_prompt=config.system_prompt,
                prompt_str=prompt_str,
                json_schema=json_schema,
                temperature=config.temperature,
            )
        if config.provider == "google":
            return _call_google(
                model=config.model,
                api_key=api_key,
                system_prompt=config.system_prompt,
                prompt_str=prompt_str,
                json_schema=json_schema,
                temperature=config.temperature,
            )
        raise ValueError(f"Unknown provider: {config.provider!r}")


def create_extract_process(config: ExtractProcessConfig[_O]) -> _ExtractProcess[_O]:
    """Factory matching TS createExtractProcess.

    Returns an object with async .run(input) -> ProcessResult[_O].
    """
    return _ExtractProcess(config)
