#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""从 CPA 同步 VS Code Custom Endpoint 模型配置；Python 3.10+，仅使用标准库。

用法：
    python sync_cpa_to_copilot_auto_auth.py --dry-run  # 只预览，不写任何文件
    python sync_cpa_to_copilot_auto_auth.py            # 有组则同步；无组则创建

仅使用普通 CPA API Key 读取 /v1/models?client_version=cpa；
不支持扩展参数时，可回退读取 /v1/models；绝不访问管理接口。
只读取 CPA，不修改 CPA 配置，也不发送模型生成请求。
备份写入本 .py 文件所在目录（不是当前工作目录，也不是配置所在目录）。
认证策略：支持自动、请求头、已有密钥引用、手动四种模式。
手动模式只同步模型，不写入认证信息；没有有效密钥引用时在最后提醒通过 VS Code 设置。
注意：Authorization 模式会把 API Key 明文写入 VS Code 的模型配置和备份。
单纯编造 ${input:chat.lm.secret.*} 并不能自动向 VS Code Secret Storage 注册密钥。
先在 VS Code 保存配置文件；运行期间不要同时编辑这个文件。
资料（实现参考；脚本运行时不会连接这些站点）：
    https://code.visualstudio.com/docs/agent-customization/language-models
    https://github.com/router-for-me/CLIProxyAPI/blob/main/internal/client/codex/models/models.go
    https://help.router-for.me/configuration/thinking
"""

from __future__ import annotations

import codecs
import copy
import datetime as dt
import fnmatch
import json
import os
from pathlib import Path
import re
import ssl
import stat
import sys
import tempfile
from typing import Any
import urllib.error
import urllib.parse
import urllib.request

DRY_RUN = False  # True 或命令行 --dry-run：仅预览，不写文件、不生成备份
# ======================= 必填配置：只需要编辑这里 =======================
# 普通模型 API 基地址，包含 /v1；也支持带反向代理前缀的地址。
CPA_API_BASE_URL = "http://127.0.0.1:15867/v1"
CPA_API_KEY = "sk-8872a319fce2bfcac9999517459f570581c82ac13583f2ee"

# 填 VS Code 实际打开的模型配置文件路径，不是通常的 settings.json。
# 支持 %APPDATA%、$HOME、~；Insiders / Profiles / Portable 请填写实际路径。
VSCODE_CONFIG_PATH = r"%APPDATA%\Code\User\chatLanguageModels.json"
TARGET_GROUP_NAME = "CPA (EasyCLIProxyAPI)"

# 认证策略：
# "auto"    : 优先复用现有 VS Code Secret Storage 引用；没有时用模型级认证头（零手工操作）。
# "headers" : 强制使用模型级 Authorization 请求头；能绕过已失效的 VS Code 密钥引用。
# "secret"  : 只使用 VS Code 已创建的 Secret Storage 引用；没有就报错，不伪造引用。
# "manual"  : 只同步模型，不自动配置密钥；没有有效 VS Code 密钥引用则在最后提示手动设置。
# 注意：auto 在首次创建组时，因不存在已注册的密钥引用，会把密钥明文写入每个模型的 requestHeaders。
API_KEY_MODE = "manual"
# ======================================================================

# 与生成请求所用接口对应。支持 "chat-completions" 或 "responses"。
# 两者均将 UI 选择写入正确的参数位置，不给模型 ID 添加 (high) 等固定后缀。
API_TYPE = "responses"
HTTP_TIMEOUT_SECONDS = 25
# 自签名证书可填写受信任 CA 的 PEM 文件路径；留空使用系统信任，不禁用验证。
TLS_CA_FILE = ""

# 普通 API 上的扩展目录开关；不需要管理密钥。
MODELS_CLIENT_VERSION = "cpa"

# 旧版本可能忽略 client_version，只返回 id 等基础字段。
# 默认拒绝用完全不含思考能力信息的目录覆盖配置，避免把现有菜单全部抹掉。
# 确认接受“同步基础模型但不生成未知思考档位”时，才改为 True。
ALLOW_BASIC_MODEL_LIST = False

# CPA 未披露某项能力时：优先沿用同 ID 旧模型的 toolCalling / vision；
# 否则使用以下“配置策略值”，并打印提示。它们不是 API 探测结果。
# True 便于在 Agent 中选择模型；只接受明确能力声明时将其改成 False。
FALLBACK_TOOL_CALLING = True
FALLBACK_VISION = False
FALLBACK_CONTEXT_WINDOW = 400000
FALLBACK_MAX_OUTPUT_TOKENS = 32768

# 仅预算型思考模型：按 CPA 的 level->budget 映射生成菜单，且不越过 min/max。
# 离散等级模型永远只使用服务器返回的 levels，不补造 xhigh/max 等档位。
ENABLE_BUDGET_EFFORT_MAPPING = True

# 非聊天模型不适合作为 Copilot 聊天模型；有特殊同名聊天别名时可删除相应项。
EXCLUDE_MODEL_PATTERNS = (
    "gpt-image-*", "dall-e-*", "text-embedding-*", "embedding-*", "whisper-*",
    "tts-*", "grok-imagine-*", "grok-tts*", "grok-voice-tts-*", "sora-*",
)

# 可选：手动指明“本次 /models 返回列表”中哪个模型可补充某个别名的能力。
# 不读取服务端别名配置，不删除命名前缀，也不从模型名称猜能力。
# 仅补全元数据；实际请求仍使用左边的模型 ID。右边必须也在本次列表内。
MODEL_METADATA_ALIASES: dict[str, str] = {
    # "my-prefix/my-model": "actual-catalog-model-id",
}

# 可选：仅当你确认能力时覆盖生成值；精确匹配客户端模型 ID。
# 不允许覆盖 id/url/reasoningEffortFormat、添加固定 reasoning_effort 或 modelOptions。
MODEL_OVERRIDES: dict[str, dict[str, Any]] = {
    # "my-model": {
    #     "toolCalling": True,
    #     "vision": True,
    #     "supportsReasoningEffort": ["low", "medium", "high"],
    #     "contextWindow": 131072,
    #     "maxOutputTokens": 16384,
    #     "apiType": "responses",
    # },
}

# ======================== 以下通常无需修改 ============================
_UNSUPPORTED = object()  # 仅表示 HTTP 层不支持扩展请求，不与 JSON null 混淆。
LEVEL_BUDGETS = {"minimal": 512, "low": 1024, "medium": 8192,
                 "high": 24576, "xhigh": 32768, "max": 128000}
LEVEL_ORDER = ("none", "minimal", "low", "medium", "high", "xhigh", "max", "ultra", "auto")
FIXED_EFFORT_RE = re.compile(r"\((?:none|auto|minimal|low|medium|high|xhigh|max|ultra|-?\d+)\)$", re.I)
NONCHAT_TYPES = {"openai-image", "image", "embedding", "embeddings", "rerank", "video", "tts", "audio"}
# 仅检测 VS Code 内置向导生成的引用；该引用背后必须存在已注册的密钥。
VSCODE_SECRET_REF_RE = re.compile(r"^\$\{input:chat\.lm\.secret\.[^{}]+\}$")


class SyncError(Exception):
    """可向用户展示的错误；不包含请求头/密钥/完整服务器响应。"""


def warn(message: str) -> None:
    print(f"[提示] {message}", file=sys.stderr)


def expand_path(value: str) -> Path:
    value = re.sub(r"%([^%]+)%", lambda m: os.environ.get(m[1], m[0]), value)
    return Path(os.path.expandvars(os.path.expanduser(value)))


def has_vscode_secret_reference(group: dict[str, Any] | None) -> bool:
    """仅确认配置中存在密钥引用，无法验证 VS Code Secret Storage 中的实际密钥。"""
    reference = group.get("apiKey") if group else None
    return isinstance(reference, str) and VSCODE_SECRET_REF_RE.fullmatch(reference) is not None


def choose_auth_mode(group: dict[str, Any] | None) -> str:
    """返回 headers/secret/manual；不猜测 Secret Storage ID 或修改其内部数据库。"""
    if API_KEY_MODE not in ("auto", "headers", "secret", "manual"):
        raise SyncError('API_KEY_MODE 只能是 "auto"、"headers"、"secret" 或 "manual"。')
    if API_KEY_MODE == "manual":
        return "manual"
    if API_KEY_MODE == "headers":
        return "headers"
    if API_KEY_MODE == "secret":
        if not has_vscode_secret_reference(group):
            raise SyncError("当前目标组没有 VS Code 已创建的密钥引用；"
                            "无法靠生成 ${input:chat.lm.secret.*} 完成密钥注册。"
                            "请先在 VS Code 中为此组设置 API Key，或将 API_KEY_MODE 改成 auto/headers/manual。")
        return "secret"
    return "secret" if has_vscode_secret_reference(group) else "headers"


def redact_model_credentials(models: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """预览输出不得显示写入模型级请求头的真实 API Key。"""
    safe = copy.deepcopy(models)
    for model in safe:
        headers = model.get("requestHeaders")
        if isinstance(headers, dict):
            for key in headers:
                if key.lower() in ("authorization", "api-key", "x-api-key", "apikey", "x-goog-api-key"):
                    value = headers[key]
                    headers[key] = "Bearer <REDACTED>" if isinstance(value, str) and value.startswith("Bearer ") else "<REDACTED>"
    return safe


def reject_constant(value: str) -> None:
    raise SyncError(f"不允许非标准 JSON 常量：{value}")


def unique_object(pairs: list[tuple[str, Any]]) -> dict[str, Any]:
    result = {}
    for key, value in pairs:
        if key in result:
            raise SyncError(f"JSON 出现重复属性 {key!r}；请先消除歧义。")
        result[key] = value
    return result


DECODER = json.JSONDecoder(object_pairs_hook=unique_object, parse_constant=reject_constant)


def clean_jsonc(text: str, *, keep_trailing_commas: bool = False) -> str:
    """将 JSONC 注释（默认连同尾逗号）替换为空格，保留全部字符偏移。"""
    chars = list(text)
    i, size = 0, len(text)
    while i < size:
        if text[i] == '"':
            # JSONDecoder 正确处理转义引号、反斜杠和字符串内的 //。
            value, end = DECODER.raw_decode(text, i)
            if not isinstance(value, str):
                raise SyncError("字符串解析失败。")
            i = end
        elif text.startswith("//", i):
            end = i + 2
            while end < size and text[end] not in "\r\n":
                end += 1
            chars[i:end] = " " * (end - i)
            i = end
        elif text.startswith("/*", i):
            end = text.find("*/", i + 2)
            if end == -1:
                raise SyncError("配置文件含有未闭合的 /* 注释。")
            end += 2
            for j in range(i, end):
                if chars[j] not in "\r\n":
                    chars[j] = " "
            i = end
        else:
            i += 1
    masked = "".join(chars)
    if keep_trailing_commas:
        return masked
    i = 0
    while i < size:
        if masked[i] == '"':
            _, i = DECODER.raw_decode(masked, i)
        else:
            if masked[i] == ',':
                j = skip_space(masked, i + 1)
                if j < size and masked[j] in "]}":
                    chars[i] = " "
            i += 1
    return "".join(chars)


def skip_space(text: str, pos: int) -> int:
    while pos < len(text) and text[pos] in " \t\r\n":
        pos += 1
    return pos


def array_items(text: str, start: int):
    pos = skip_space(text, start + 1)
    while text[pos] != ']':
        begin = pos
        value, end = DECODER.raw_decode(text, pos)
        yield value, begin, end
        pos = skip_space(text, end)
        if text[pos] == ',':
            pos = skip_space(text, pos + 1)


def object_members(text: str, start: int):
    pos = skip_space(text, start + 1)
    while text[pos] != '}':
        key_pos = pos
        key, end = DECODER.raw_decode(text, pos)
        colon = skip_space(text, end)
        begin = skip_space(text, colon + 1)
        value, end = DECODER.raw_decode(text, begin)
        yield key, value, key_pos, begin, end
        pos = skip_space(text, end)
        if text[pos] == ',':
            pos = skip_space(text, pos + 1)


def locate_group(text: str) -> tuple[list[Any], int | None, dict[str, Any] | None,
                                     int | None, int | None, int | None]:
    """定位唯一目标组；不存在时返回 None，重复或结构不合法仍拒绝修改。"""
    clean = clean_jsonc(text)
    root = DECODER.decode(clean)
    if not isinstance(root, list):
        raise SyncError("配置顶层应是 provider 数组。请指向 chatLanguageModels.json，而不是 settings.json。")
    matches = []
    for index, (value, begin, _) in enumerate(array_items(clean, skip_space(clean, 0))):
        if isinstance(value, dict) and value.get("name") == TARGET_GROUP_NAME:
            matches.append((index, value, begin))
    if not matches:
        return root, None, None, None, None, None
    if len(matches) != 1:
        raise SyncError(f"发现 {len(matches)} 个同名组 {TARGET_GROUP_NAME!r}；请先处理重复组，未修改文件。")
    index, group, begin = matches[0]
    if group.get("vendor") != "customendpoint":
        raise SyncError("目标组 vendor 不是 customendpoint；拒绝覆盖其他类型的组。")
    if group.get("url"):
        raise SyncError("目标组含组级 url，会触发自动发现并忽略显式 models；请先在 VS Code 中改为显式模型配置。")
    for key, value, key_pos, start, end in object_members(clean, begin):
        if key == "models":
            if not isinstance(value, list):
                raise SyncError("目标组的 models 必须是数组；未修改文件。")
            return root, index, group, key_pos, start, end
    raise SyncError("目标组没有 models 数组。请先在该组中添加空的 models: []。")


def append_group(text: str, root: list[Any], models: list[dict[str, Any]]) -> str:
    """向顶层 JSONC 数组追加组，保留现有组/注释/换行及原先的尾逗号。"""
    # 不把原始 Key 放到组级 apiKey：该属性受 VS Code Secret Storage 机制接管，
    # 明文字符串可能被静默忽略。headers 模式由 models[*].requestHeaders 提供认证；
    # manual 模式创建不含密钥的新组，留给用户在 VS Code 界面手动配置。
    group = {
        "name": TARGET_GROUP_NAME,
        "vendor": "customendpoint",
        "models": models,
    }
    clean = clean_jsonc(text)
    start = skip_space(clean, 0)
    _, end = DECODER.raw_decode(clean, start)
    close = end - 1
    if clean[start] != "[" or clean[close] != "]":
        raise SyncError("配置顶层不是有效的数组；拒绝插入新组。")
    items = list(array_items(clean, start))
    if len(items) != len(root):
        raise SyncError("JSONC 数组条目解析异常；未修改文件。")

    newline = "\r\n" if "\r\n" in text else "\n"
    # 尽量沿用顶层已有组的缩进；若数组为 [] 则使用两个空格。
    indent = "  "
    if items:
        first_begin = items[0][1]
        prefix = text[text.rfind("\n", 0, first_begin) + 1:first_begin]
        if prefix and all(char in " \t\r" for char in prefix):
            indent = prefix
        else:
            prefix = text[text.rfind("\n", 0, close) + 1:close]
            if prefix and all(char in " \t\r" for char in prefix):
                indent = prefix + ("\t" if "\t" in prefix else "  ")
    # 将对象序列化为标准 JSON，再用检测到的缩进和换行符格式化。
    group_json = json.dumps(group, ensure_ascii=False, allow_nan=False, indent=indent)
    group_json = group_json.replace("\n", newline + indent)

    # 若 ] 在单独一行，就在其行首插入，保持 ] 的现有缩进。
    line_start = text.rfind("\n", 0, close) + 1
    has_closing_line = (line_start > start and not text[line_start:close].strip())
    if has_closing_line:
        insert_at = line_start
        addition = indent + group_json + newline
    else:
        insert_at = close
        addition = newline + indent + group_json + newline

    # 已有条目且没有尾逗号时，在最后一个值后补上分隔逗号（先于行注释）。
    if items:
        last_end = items[-1][2]
        original_no_comments = clean_jsonc(text, keep_trailing_commas=True)
        has_comma = "," in original_no_comments[last_end:close]
        if not has_comma:
            text = text[:last_end] + "," + text[last_end:]
            if insert_at >= last_end:
                insert_at += 1
    patched = text[:insert_at] + addition + text[insert_at:]
    after = DECODER.decode(clean_jsonc(patched))
    if after != [*root, group]:
        raise SyncError("安全检查失败：创建新组时检测到其他配置变化。")
    return patched


def patch_models(text: str, models: list[dict[str, Any]]) -> str:
    if not models:
        raise SyncError("新列表为空，拒绝清空现有模型。")
    root, index, _, key_pos, start, end = locate_group(text)
    if index is None:
        return append_group(text, root, models)
    assert key_pos is not None and start is not None and end is not None
    line = text[text.rfind('\n', 0, key_pos) + 1:key_pos]
    base_indent = re.match(r"[ \t]*", line).group(0)
    unit = "\t" if "\t" in base_indent else (" " * (len(base_indent) // 2 or 4))
    # 更优先沿用旧模型对象相对于 models 属性的缩进。
    match = re.search(r"\n([ \t]+)\{", text[start:end])
    if match and match[1].startswith(base_indent):
        candidate = match[1][len(base_indent):]
        if candidate:
            unit = candidate
    newline = "\r\n" if "\r\n" in text else "\n"
    rendered = json.dumps(models, ensure_ascii=False, indent=unit, allow_nan=False)
    rendered = rendered.replace("\n", newline + base_indent)
    patched = text[:start] + rendered + text[end:]
    # 再次验证完整 JSONC；除了目标数组，结构也必须完全相同。
    after = DECODER.decode(clean_jsonc(patched))
    expected = copy.deepcopy(root)
    expected[index]["models"] = models
    if after != expected:
        raise SyncError("安全检查失败：检测到目标 models 以外的结构变化。")
    return patched


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        raise SyncError("API 返回重定向；为防止泄露密钥已停止。请填写最终 API 地址。")


class CPAClient:
    def __init__(self) -> None:
        context = ssl.create_default_context(cafile=str(expand_path(TLS_CA_FILE)) if TLS_CA_FILE else None)
        self.opener = urllib.request.build_opener(NoRedirect(), urllib.request.HTTPSHandler(context=context))

    def get(self, url: str, optional_statuses: tuple[int, ...] = ()) -> Any:
        parts = urllib.parse.urlsplit(url)
        if parts.scheme not in ("http", "https") or not parts.netloc or parts.username or parts.password:
            raise SyncError("API 地址必须是无内嵌凭证的完整 http/https URL。")
        req = urllib.request.Request(url, headers={
            "Authorization": "Bearer " + CPA_API_KEY,
            "Accept": "application/json",
            "User-Agent": "cpa-copilot-config-sync/2.0",
        }, method="GET")
        try:
            with self.opener.open(req, timeout=HTTP_TIMEOUT_SECONDS) as response:
                data = response.read(16 * 1024 * 1024 + 1)
                if len(data) > 16 * 1024 * 1024:
                    raise SyncError("API 返回超过 16 MiB，已停止。")
                return json.loads(data.decode("utf-8-sig"), object_pairs_hook=unique_object, parse_constant=reject_constant)
        except urllib.error.HTTPError as exc:
            code = exc.code
            exc.close()
            if code in optional_statuses:
                return _UNSUPPORTED
            if code in (401, 403):
                raise SyncError(f"{parts.path} 返回 HTTP {code}：请检查普通 CPA API Key；不会继续重试。") from None
            raise SyncError(f"{parts.path} 返回 HTTP {code}；配置文件未修改。") from None
        except (urllib.error.URLError, TimeoutError, OSError) as exc:
            raise SyncError(f"无法读取 {parts.path}（{type(exc).__name__}）；检查地址、网络、代理或证书。") from None
        except (UnicodeDecodeError, json.JSONDecodeError):
            raise SyncError(f"{parts.path} 未返回有效 JSON；检查是否误填了网页地址。") from None


def rows(payload: Any, field: str) -> list[dict[str, Any]]:
    data = payload.get(field) if isinstance(payload, dict) else payload
    if not isinstance(data, list):
        raise SyncError(f"API 响应缺少数组字段 {field!r}。")
    if any(not isinstance(item, dict) for item in data):
        raise SyncError(f"API 的 {field!r} 数组包含非对象条目。")
    return data


def normalize_models(payload: Any) -> tuple[list[dict[str, Any]], str]:
    """兼容扩展 {models:[{slug:...}]} 和普通 {data:[{id:...}]}。"""
    if not isinstance(payload, dict):
        raise SyncError("模型接口必须返回 JSON 对象。")
    if "models" in payload:
        field, id_key, alternative = "models", "slug", "id"
    elif "data" in payload:
        field, id_key, alternative = "data", "id", "slug"
    else:
        raise SyncError("模型响应既没有 models 数组，也没有 data 数组；未修改文件。")
    result, seen = [], set()
    for item in rows(payload, field):
        model_id = item.get(id_key, item.get(alternative))
        if not isinstance(model_id, str) or not model_id.strip():
            raise SyncError("模型响应中存在缺失/非法 id 或 slug 的条目；未修改文件。")
        if model_id in seen:
            raise SyncError(f"模型接口返回重复 ID {model_id!r}；未修改文件。")
        seen.add(model_id)
        entry = dict(item)
        entry["id"] = model_id  # 保留服务端可调用 ID，包括前缀/别名。
        result.append(entry)
    if not result:
        raise SyncError("CPA 返回空模型列表；拒绝清空原配置。")
    return result, field


def fetch_models(client: CPAClient) -> list[dict[str, Any]]:
    """最多两个只读请求，均在普通 /v1/models 上，均使用同一普通 API Key。"""
    url = CPA_API_BASE_URL.rstrip("/") + "/models"
    query = urllib.parse.urlencode({"client_version": MODELS_CLIENT_VERSION})
    payload = client.get(url + "?" + query, optional_statuses=(400, 404, 405, 422, 501))
    source = "/models?" + query
    if payload is _UNSUPPORTED:
        warn("扩展 models 请求不受支持，回退读取普通 /models；不会访问其他服务。")
        payload = client.get(url)
        source = "/models"
    available, shape = normalize_models(payload)
    print(f"模型来源：{source}（{shape} 数组，{len(available)} 个模型）")
    # 普通接口若忽略查询参数并直接返回 data，不再发送重复请求。
    # 空数组是“未列出档位”，不是“不支持思考”；未知时绝不根据模型名补造。
    effort_fields = ("supported_reasoning_levels", "supportsReasoningEffort",
                     "supported_reasoning_efforts", "thinking", "supports_thinking")
    has_effort_metadata = any(
        any(item.get(key) is not None for key in effort_fields) for item in available
    )
    has_manual_effort = any(
        isinstance(MODEL_OVERRIDES.get(item["id"]), dict) and
        any(MODEL_OVERRIDES[item["id"]].get(key) is not None
            for key in ("supportsReasoningEffort", "thinking"))
        for item in available
    )
    if not has_effort_metadata:
        message = ("服务器没有返回任何思考能力字段；可能未支持扩展模型目录，"
                   "或网关忽略了 client_version。不能仅凭模型 ID 推导档位。")
        if not ALLOW_BASIC_MODEL_LIST and not has_manual_effort:
            raise SyncError(message + " 原配置未修改。请使用支持扩展目录的 CPA，"
                            "或在 MODEL_OVERRIDES 明确补充能力；"
                            "只同步基础列表可设置 ALLOW_BASIC_MODEL_LIST = True。")
        warn(message + " 本次只为有明确能力/手工覆盖的模型生成档位。")
    return available


def ordered_levels(values: Any) -> list[str]:
    if not isinstance(values, list) or any(not isinstance(v, str) or not v.strip() for v in values):
        raise SyncError("思考 levels 必须是非空字符串组成的数组。")
    normalized = {v.strip().lower() for v in values}
    return [v for v in LEVEL_ORDER if v in normalized] + sorted(normalized - set(LEVEL_ORDER))


def parse_effort_levels(values: Any, field: str) -> list[str]:
    if not isinstance(values, list):
        raise SyncError(f"{field} 必须是数组。")
    names = []
    for value in values:
        # CPA 扩展目录采用 {"effort": "high", "description": "..."}。
        # 同时接受部分兼容服务直接返回字符串数组的形式。
        name = value.get("effort") if isinstance(value, dict) else value
        if not isinstance(name, str) or not name.strip():
            raise SyncError(f"{field} 含无效的 effort 条目。")
        names.append(name)
    return ordered_levels(names)


def effort_info(meta: dict[str, Any]) -> tuple[bool | None, list[str], str]:
    """只信本次响应；空 supported_reasoning_levels 不等于不支持思考。"""
    empty_levels = False
    for field in ("supportsReasoningEffort", "supported_reasoning_levels", "supported_reasoning_efforts"):
        if meta.get(field) is not None:
            levels = parse_effort_levels(meta[field], field)
            if levels:
                return True, levels, f"服务器 {field}"
            empty_levels = True
    thinking = meta.get("thinking")
    if isinstance(thinking, dict):
        if thinking.get("levels"):
            return True, ordered_levels(thinking["levels"]), "服务器 thinking.levels"
        lower, upper = thinking.get("min", 0), thinking.get("max", 0)
        if type(lower) is not int or type(upper) is not int or lower < 0 or upper < 0:
            raise SyncError("thinking.min/max 必须是非负整数。")
        if upper and upper < lower:
            raise SyncError("thinking.max 小于 thinking.min。")
        levels = []
        if ENABLE_BUDGET_EFFORT_MAPPING and upper > 0:
            levels = [name for name, budget in LEVEL_BUDGETS.items() if lower <= budget <= upper]
            if thinking.get("zero_allowed", thinking.get("zero-allowed", False)) is True:
                levels.append("none")
            if thinking.get("dynamic_allowed", thinking.get("dynamic-allowed", False)) is True:
                levels.append("auto")
        supported = upper > 0 or lower > 0 or thinking.get("dynamic_allowed") is True
        return supported, ordered_levels(levels), "CPA预算映射" if levels else "仅原始 thinking 声明"
    if isinstance(thinking, bool):
        return thinking, [], "已声明思考但未披露档位" if thinking else "明确声明不支持思考"
    if type(meta.get("supports_thinking")) is bool:
        return meta["supports_thinking"], [], "服务器 supports_thinking"
    if empty_levels:
        return None, [], "目录未列出可选档位（不代表不支持思考）"
    return None, [], "能力未知"


def resolve_metadata(model: dict[str, Any], index: dict[str, dict[str, Any]]) -> tuple[list[dict[str, Any]], str, bool]:
    """手工别名只能指向本次模型列表，不访问别名管理/静态目录。"""
    lookup = MODEL_METADATA_ALIASES.get(model["id"])
    if lookup is None:
        return [], "models响应", False
    if not isinstance(lookup, str) or not lookup:
        raise SyncError("MODEL_METADATA_ALIASES 的目标 ID 必须是非空字符串。")
    if FIXED_EFFORT_RE.search(lookup):
        return [], "手工元数据别名", True
    entry = index.get(lookup)
    return ([entry] if entry else []), ("手工元数据别名:" + lookup if entry else "手工别名目标不在models列表"), False


def first_int(meta: dict[str, Any], keys: tuple[str, ...]) -> int | None:
    for key in keys:
        value = meta.get(key)
        if type(value) is int and value > 0:
            return value
    return None


def numeric_cap(model: dict[str, Any], candidates: list[dict[str, Any]], keys: tuple[str, ...]) -> int | None:
    actual = first_int(model, keys)
    if actual is not None:
        return actual
    values = [value for entry in candidates if (value := first_int(entry, keys)) is not None]
    return min(values) if values else None


def boolean_cap(meta: dict[str, Any], capability: str) -> bool | None:
    names = ("toolCalling", "tool_calling", "supports_tool_calling") if capability == "tools" else ("vision", "supports_vision")
    for name in names:
        if type(meta.get(name)) is bool:
            return meta[name]
    if capability == "tools":
        parameters = meta.get("supported_parameters")
        if isinstance(parameters, list) and {"tools", "tool_choice", "functions", "function_call"}.intersection(parameters):
            return True
    else:
        modalities = meta.get("supportedInputModalities", meta.get("input_modalities"))
        if modalities is None and isinstance(meta.get("architecture"), dict):
            modalities = meta["architecture"].get("input_modalities")
        if isinstance(modalities, list) and modalities:
            return "image" in {str(value).lower() for value in modalities}
    return None


def resolve_bool(model: dict[str, Any], entries: list[dict[str, Any]], old: dict[str, Any],
                 capability: str, notes: list[str]) -> bool:
    actual = boolean_cap(model, capability)
    if actual is not None:
        return actual
    values = [boolean_cap(item, capability) for item in entries]
    if False in values:
        return False
    if values and all(value is True for value in values):
        return True
    field = "toolCalling" if capability == "tools" else "vision"
    if type(old.get(field)) is bool:
        notes.append(f"{field}沿用同ID旧值")
        return old[field]
    fallback = FALLBACK_TOOL_CALLING if capability == "tools" else FALLBACK_VISION
    notes.append(f"{field}未披露，策略值={str(fallback).lower()}")
    return fallback


def build_models(available: list[dict[str, Any]], old_models: list[Any], *,
                 auth_mode: str = "secret") -> tuple[list[dict[str, Any]], list[str]]:
    if auth_mode not in ("secret", "headers", "manual"):
        raise SyncError("内部认证模式无效。")
    old = {m["id"]: m for m in old_models if isinstance(m, dict) and isinstance(m.get("id"), str)}
    built, report = [], []
    index = {item["id"]: item for item in available}
    seen = set()
    for model in sorted(available, key=lambda item: str(item.get("id", ""))):
        model_id = model.get("id")
        if not isinstance(model_id, str) or not model_id.strip():
            raise SyncError("/v1/models 含缺失/非法 id 的条目；未修改文件。")
        if model_id in seen:
            raise SyncError(f"/v1/models 返回重复 ID {model_id!r}；未修改文件。")
        seen.add(model_id)
        if FIXED_EFFORT_RE.search(model_id):
            report.append(f"[跳过] {model_id}：ID 已固定思考档位，避免覆盖 UI 选择。")
            continue
        if str(model.get("type", "")).lower() in NONCHAT_TYPES or any(
                fnmatch.fnmatchcase(name.lower(), pattern.lower())
                for name in (model_id, model_id.rsplit("/", 1)[-1]) for pattern in EXCLUDE_MODEL_PATTERNS):
            report.append(f"[跳过] {model_id}：非聊天类型/排除规则。")
            continue
        entries, source, fixed_alias = resolve_metadata(model, index)
        if fixed_alias:
            report.append(f"[跳过] {model_id}：手工元数据别名目标固定了思考后缀。")
            continue
        output_modalities = model.get("supportedOutputModalities", model.get("output_modalities"))
        if output_modalities is None and len(entries) == 1:
            output_modalities = entries[0].get("supportedOutputModalities", entries[0].get("output_modalities"))
        if isinstance(output_modalities, list) and output_modalities and "text" not in {str(x).lower() for x in output_modalities}:
            report.append(f"[跳过] {model_id}：未声明文本输出。")
            continue
        notes = []
        thinking, levels, how = effort_info(model)
        if thinking is None and entries:
            thinking, levels, how = effort_info(entries[0])
            how += "（手工指定的元数据别名）"
        if thinking is None:
            notes.append("未获得明确思考能力，不生成档位菜单；可用 MODEL_OVERRIDES 补充")
        output = numeric_cap(model, entries, ("max_completion_tokens", "outputTokenLimit", "maxOutputTokens", "max_output_tokens", "max_tokens"))
        context = numeric_cap(model, entries, ("max_context_length", "context_length", "contextWindow", "context_window", "max_context_window"))
        input_limit = numeric_cap(model, entries, ("inputTokenLimit", "max_input_tokens", "maxInputTokens"))
        if output is None:
            output = FALLBACK_MAX_OUTPUT_TOKENS
            notes.append(f"输出上限未披露，策略值={output}")
        if context is not None:
            if context < 2:
                raise SyncError(f"{model_id}: 声明的上下文不足以同时容纳输入和输出。")
            if output >= context:
                output = min(FALLBACK_MAX_OUTPUT_TOKENS, max(1, context // 4))
                notes.append("输出额度已缩小以保留输入空间")
            context_window = context
        elif input_limit is not None:
            # 没有总上下文证据时，保守地将输入上限用作总窗口估值。
            output = min(output, max(1, input_limit // 4))
            context_window = input_limit
            notes.append("总上下文未披露，保守地以输入上限估算总窗口")
        else:
            output = min(output, max(1, FALLBACK_CONTEXT_WINDOW // 4))
            context_window = FALLBACK_CONTEXT_WINDOW
            notes.append(f"上下文未披露，策略值={FALLBACK_CONTEXT_WINDOW}")
        generated = {
            "id": model_id,
            "name": model.get("display_name") or (entries[0].get("display_name") if len(entries) == 1 else None) or model_id,
            "url": "",  # 在 per-model apiType 覆盖后统一设置。
            "apiType": API_TYPE,
            "toolCalling": resolve_bool(model, entries, old.get(model_id, {}), "tools", notes),
            "vision": resolve_bool(model, entries, old.get(model_id, {}), "vision", notes),
            "contextWindow": context_window,
            "maxOutputTokens": output,
        }
        if thinking is not None:
            generated["thinking"] = thinking
        if levels:
            generated["supportsReasoningEffort"] = levels
        override = MODEL_OVERRIDES.get(model_id, {})
        if not isinstance(override, dict):
            raise SyncError(f"{model_id}: MODEL_OVERRIDES 条目必须是对象。")
        allowed = {"name", "apiType", "toolCalling", "vision", "contextWindow", "maxOutputTokens", "thinking", "supportsReasoningEffort", "streaming"}
        if set(override) - allowed:
            raise SyncError(f"{model_id} 的 MODEL_OVERRIDES 包含不允许的字段。")
        generated.update(override)
        if override.get("thinking") is False:
            if override.get("supportsReasoningEffort"):
                raise SyncError(f"{model_id}: thinking=False 不能同时声明非空思考档位。")
            generated.pop("supportsReasoningEffort", None)
        if "supportsReasoningEffort" in generated:
            values = ordered_levels(generated["supportsReasoningEffort"])
            if values:
                generated["supportsReasoningEffort"] = values
                generated["thinking"] = True
            else:
                generated.pop("supportsReasoningEffort", None)
        if not isinstance(generated["name"], str) or not generated["name"].strip():
            raise SyncError(f"{model_id}: 显示名称必须是非空字符串。")
        for field in ("toolCalling", "vision", "thinking", "streaming"):
            if field in generated and type(generated[field]) is not bool:
                raise SyncError(f"{model_id}: {field} 必须是布尔值。")
        for field in ("contextWindow", "maxOutputTokens"):
            if type(generated[field]) is not int or generated[field] <= 0:
                raise SyncError(f"{model_id}: {field} 必须是正整数。")
        if generated["maxOutputTokens"] >= generated["contextWindow"]:
            raise SyncError(f"{model_id}: 输出额度必须小于总上下文窗口，以保留输入空间。")
        if context is not None and generated["contextWindow"] > context:
            raise SyncError(f"{model_id}: 总上下文窗口超过 CPA 声明的上下文。")
        api_type = generated["apiType"]
        if api_type not in ("chat-completions", "responses"):
            raise SyncError("API_TYPE/apiType 只能是 chat-completions 或 responses。")
        endpoint = "chat/completions" if api_type == "chat-completions" else "responses"
        generated["url"] = CPA_API_BASE_URL.rstrip("/") + "/" + endpoint
        if "supportsReasoningEffort" in generated:
            generated["reasoningEffortFormat"] = api_type
        if api_type == "responses":
            generated["statefulResponses"] = False
        if auth_mode == "headers":
            # VS Code CustomEndpoint 会将自定义 Authorization 按原样送出，
            # 同时抑制依据组级 apiKey 推断的默认认证头。
            # 注意：该 Key 会以明文存在于 chatLanguageModels.json 及备份中。
            generated["requestHeaders"] = {"Authorization": "Bearer " + CPA_API_KEY}
        built.append(generated)
        menu = ", ".join(generated.get("supportsReasoningEffort", [])) or "无可选档位"
        report.append(f"[模型] {model_id} | {menu} | {source} | {how}" + (" | 手工覆盖" if override else ""))
        if notes:
            report.append("       " + "；".join(notes))
    if not built:
        raise SyncError("没有可写入的聊天模型；拒绝清空原有模型配置。")
    return built, report


def safe_write(path: Path, original: bytes, replacement: bytes) -> Path | None:
    if replacement == original:
        return None
    if path.read_bytes() != original:
        raise SyncError("配置在同步期间被其他程序修改，已停止；请保存后重试。")
    mode = stat.S_IMODE(path.stat().st_mode)
    timestamp = dt.datetime.now().strftime("%Y%m%d-%H%M%S-%f")
    # 必须按脚本文件定位，不能使用 Path.cwd() 或配置文件的父目录。
    backup = Path(__file__).resolve().parent / (path.name + ".bak." + timestamp)
    # 备份含原配置中可能存在的密钥；POSIX 下限制权限，Windows 下继承目录 ACL。
    # 备份无法写入时直接失败，绝不在没有备份的情况下改动配置。
    fd = os.open(backup, os.O_WRONLY | os.O_CREAT | os.O_EXCL, mode & 0o600 or 0o600)
    try:
        with os.fdopen(fd, "wb") as handle:
            handle.write(original)
            handle.flush()
            os.fsync(handle.fileno())
    except OSError:
        try:
            backup.unlink()
        except OSError:
            pass
        raise
    temp_name = None
    try:
        fd, temp_name = tempfile.mkstemp(prefix=path.name + ".", suffix=".tmp", dir=path.parent)
        with os.fdopen(fd, "wb") as handle:
            handle.write(replacement)
            handle.flush()
            os.fsync(handle.fileno())
        os.chmod(temp_name, mode)
        if path.read_bytes() != original:
            raise SyncError("写入前检测到并发修改，已停止；原配置未被本脚本覆盖。")
        os.replace(temp_name, path)
        temp_name = None
    finally:
        if temp_name is not None:
            try:
                os.unlink(temp_name)
            except OSError:
                pass
    return backup


def main() -> int:
    args = set(sys.argv[1:])
    if args - {"--dry-run"}:
        raise SyncError("仅支持 --dry-run 参数；其他设置请修改文件头部的常量。")
    dry_run = DRY_RUN or "--dry-run" in args
    if not isinstance(CPA_API_KEY, str) or not CPA_API_KEY or CPA_API_KEY.startswith("填写"):
        raise SyncError("请先填写文件头部 CPA_API_KEY（普通 API Key）。")
    if CPA_API_KEY != CPA_API_KEY.strip():
        raise SyncError("CPA_API_KEY 包含前后空白字符，请清理后重试，以防发送无效密钥。")
    if any(ord(char) < 32 or ord(char) > 126 for char in CPA_API_KEY):
        raise SyncError("CPA_API_KEY 必须为不含控制字符的 ASCII 字符串。")
    parsed = urllib.parse.urlsplit(CPA_API_BASE_URL)
    if parsed.scheme not in ("http", "https") or not parsed.netloc or parsed.username or parsed.password:
        raise SyncError("CPA_API_BASE_URL 必须为无内嵌凭证的 http/https 地址。")
    if parsed.query or parsed.fragment:
        raise SyncError("CPA_API_BASE_URL 不得含查询参数或 #fragment。")
    if not CPA_API_BASE_URL.rstrip("/").endswith("/v1"):
        raise SyncError("CPA_API_BASE_URL 请填写以 /v1 结尾的基地址。")
    if API_TYPE not in ("chat-completions", "responses"):
        raise SyncError("API_TYPE 只能为 chat-completions 或 responses。")
    if not isinstance(MODELS_CLIENT_VERSION, str) or not MODELS_CLIENT_VERSION:
        raise SyncError("MODELS_CLIENT_VERSION 必须是非空字符串。")
    for name, value in (("FALLBACK_CONTEXT_WINDOW", FALLBACK_CONTEXT_WINDOW),
                        ("FALLBACK_MAX_OUTPUT_TOKENS", FALLBACK_MAX_OUTPUT_TOKENS)):
        if type(value) is not int or value < 2:
            raise SyncError(f"{name} 必须是至少为 2 的整数。")
    path = expand_path(VSCODE_CONFIG_PATH).resolve(strict=True)
    original = path.read_bytes()
    bom = codecs.BOM_UTF8 if original.startswith(codecs.BOM_UTF8) else b""
    text = original[len(bom):].decode("utf-8")
    _, _, group, _, _, _ = locate_group(text)
    creating = group is None
    auth_mode = choose_auth_mode(group)
    if creating:
        warn(f"未找到 {TARGET_GROUP_NAME!r} 组：将自动创建 customendpoint 组。")
    if auth_mode == "headers":
        warn("本次使用模型级 Authorization 认证头：Key 会明文保存在 chatLanguageModels.json 及其备份中。"
             "请勿提交到 Git 或与他人共享。")
        if group and group.get("apiKey"):
            warn("现有组级 apiKey 保留不变，但模型级 Authorization 将优先生效；"
                 "可在确认正常后使用 VS Code 的设置界面清理过期密钥。")
    elif auth_mode == "manual":
        print("认证方式：manual（手动配置）。本次不会自动写入 apiKey 或模型级 Authorization 请求头。")
        if group and group.get("apiKey") and not has_vscode_secret_reference(group):
            warn("目标组的 apiKey 不是可识别的 VS Code 密钥引用；建议在 VS Code 中重新设置。")
    else:
        print("认证方式：复用现有 VS Code Secret Storage 引用（不会重写密钥）。")
    print(f"目标文件：{path}\n目标组：{TARGET_GROUP_NAME}")
    print(f"备份目录：{Path(__file__).resolve().parent}（脚本所在目录）")
    client = CPAClient()
    available = fetch_models(client)
    old_models = [] if creating else group["models"]
    models, report = build_models(available, old_models, auth_mode=auth_mode)
    for line in report:
        print(line)
    patched = patch_models(text, models)
    replacement = bom + patched.encode("utf-8")
    menu_count = sum(bool(m.get("supportsReasoningEffort")) for m in models)
    print(f"\n旧模型 {len(old_models)} 个 -> 新模型 {len(models)} 个；其中 {menu_count} 个有思考档位菜单。")
    if dry_run:
        print(f"\n--- 仅预览：{'将创建新组' if creating else '将更新目标组'}；未写入文件 ---")
        print(json.dumps(redact_model_credentials(models), ensure_ascii=False, indent=2))
    else:
        backup = safe_write(path, original, replacement)
        if backup is None:
            print("生成内容与现有配置相同，无需写入。")
        else:
            print(f"已{'创建目标组并写入 models' if creating else '仅替换目标组 models 数组'}。\n备份：{backup}")
    if creating:
        if auth_mode == "headers":
            print("\n新组使用 vendor=customendpoint，认证方式为模型级 Authorization；其他已有组不变。")
        elif auth_mode == "manual":
            print("\n新组使用 vendor=customendpoint；不会自动写入组级 apiKey 或模型级认证头。")
        else:
            print("\n新组使用 vendor=customendpoint；其他已有组不变。")
    else:
        print("\n未修改原组的 apiKey/vendor/name 或其他设置；认证由本次选择的策略决定。")
    if auth_mode == "headers":
        print("注意：凭据以明文存在于配置文件及备份中。若要使用加密引用，"
              "请先通过 VS Code 更新密钥，再将 API_KEY_MODE 改为 auto 或 secret 并重新运行。")
    print("models 目录可能含服务端模板信息，不是上游实测；未知能力不会凭模型名称编造。")
    print("本脚本不读取服务端别名/覆盖规则；请确认它们及插件未固定、覆盖或移除思考参数。")
    # 将手动认证提醒放在所有常规输出之后，确保双击运行时也能直接看到。
    if auth_mode == "manual":
        if has_vscode_secret_reference(group):
            print("\n[手动认证] 发现现有 VS Code 密钥引用，本次已保留（无法检测其是否有效）。")
        else:
            print("\n========== 需要在 VS Code 手动配置 API Key ==========")
            if dry_run:
                print("当前是 --dry-run，仅预览了模型；正式运行生成配置后再设置密钥。")
            print(f"目标模型组：{TARGET_GROUP_NAME}")
            print("1. 在 VS Code 按 Ctrl+Shift+P，运行 Chat: Manage Language Models。")
            print("2. 找到目标模型组，通过菜单选择 Update API Key（更新 API 密钥）。")
            print("3. 输入 CPA 的普通 API Key（不是 Management Key），并保存。")
            print("4. 运行 Developer: Reload Window，然后再选择模型测试。")
            print("完成之前模型请求可能返回 401；本脚本不会生成虚假的 Secret Storage 引用。")
    return 0


if __name__ == "__main__":
    try:
        a = main()
        print(f"脚本退出，返回码 {a}")
        input("按回车键退出...")
        raise SystemExit(a)
    except (SyncError, OSError, UnicodeError, ValueError, RecursionError) as exc:
        # 脚本和异常消息中不输出 API 请求头或服务器原始响应。
        print(f"错误：{exc}", file=sys.stderr)
        raise SystemExit(1)
    except KeyboardInterrupt:
        print("\n操作已中止。", file=sys.stderr)
        raise SystemExit(130)
