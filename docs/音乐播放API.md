# 音乐播放 REST API

本文档描述音乐播放相关 HTTP API。内容仅包含接口地址、请求参数、响应结构、错误结构和调用示例。

验证时间: 2026-06-08

上游 API 首页说明更新时间: 2026-02-06

## 基础信息

Base URL:

```text
https://music-api.gdstudio.xyz
```

统一入口:

```text
GET /api.php
```

请求约定:

| 项 | 说明 |
|---|---|
| 协议 | HTTPS |
| 方法 | GET |
| 参数位置 | Query string |
| 响应格式 | JSON |
| 鉴权 | 未使用鉴权 |
| 字符编码 | UTF-8 |
| 频率限制 | 上游说明为 5 分钟内不超过 50 次请求 |

所有接口通过 `types` 参数区分能力。

## 枚举

### source

已验证可用于搜索的来源:

| 值 | 说明 | 备注 |
|---|---|---|
| `netease` | 网易云音乐 | 搜索、播放地址、封面、歌词已验证。 |
| `joox` | JOOX | 搜索、播放地址、封面、歌词已验证。 |
| `kuwo` | 酷我音乐 | 搜索、封面已验证；部分歌曲可能返回空播放地址或空歌词。 |

上游 API 首页标注当前稳定音乐源为 `netease`、`kuwo`、`joox`。

以下来源在 2026-06-08 验证时返回 `source` 不支持:

| 值 | 错误 |
|---|---|
| `tencent` | `Value of source is not supported.` |
| `kugou` | `Value of source is not supported.` |
| `migu` | `Value of source is not supported.` |
| `deezer` | `Value of source is not supported.` |
| `spotify` | `Value of source is not supported.` |
| `apple` | `Value of source is not supported.` |
| `ytmusic` | `Value of source is not supported.` |
| `tidal` | `Value of source is not supported.` |
| `qobuz` | `Value of source is not supported.` |
| `ximalaya` | `Value of source is not supported.` |

### br

音质码率。

| 值 | 说明 |
|---|---|
| `128` | 标准 128K |
| `192` | 较高 192K |
| `320` | 高品质 320K |
| `740` | 无损 FLAC |
| `999` | Hi-Res |

`br` 可省略。省略时上游按默认音质处理，实际音质以响应体 `br` 为准。

## 通用错误

错误响应:

```json
{
  "detail": "Value of `source` is not supported."
}
```

字段:

| 字段 | 类型 | 说明 |
|---|---|---|
| `detail` | string | 错误说明。 |

已验证错误:

| HTTP 状态 | 场景 | 响应 |
|---|---|---|
| `400` | `source` 不支持 | `{"detail":"Value of `source` is not supported."}` |
| `400` | `types` 不支持 | `{"detail":"Value of `types` is not supported."}` |

## 数据结构

### Song

搜索接口返回的歌曲对象。

```json
{
  "id": "3387145907",
  "name": "TEST",
  "artist": ["YeZippo"],
  "album": "Y3K",
  "pic_id": "109951173290929555",
  "url_id": "3387145907",
  "lyric_id": "3387145907",
  "source": "netease",
  "from": "music.gdstudio.xyz"
}
```

字段:

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `id` | string 或 number | 是 | 歌曲 ID。 |
| `name` | string | 是 | 歌曲名。 |
| `artist` | string[] | 是 | 歌手列表。 |
| `album` | string | 是 | 专辑名。 |
| `pic_id` | string 或 number | 否 | 封面 ID；可能为空字符串。 |
| `url_id` | string 或 number | 否 | 播放地址 ID；获取播放地址时优先使用。 |
| `lyric_id` | string 或 number | 否 | 歌词 ID；获取歌词时优先使用。 |
| `source` | string | 是 | 音乐来源。 |
| `from` | string | 否 | 数据来源标识。 |

### AudioUrlResponse

```json
{
  "url": "https://example.com/audio.mp3",
  "br": 320,
  "size": 5005485,
  "from": "music.gdstudio.xyz"
}
```

字段:

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `url` | string | 是 | 音频地址。可能为空字符串；非空才表示可播放。 |
| `br` | number | 是 | 实际返回音质。资源不可用时可能为 `-1`。 |
| `size` | number | 是 | 文件大小。上游文档称单位为 KB，实测返回值更接近 byte；资源不可用时可能为 `0`。 |
| `from` | string | 否 | 数据来源标识。 |

资源不可用示例:

```json
{
  "url": "",
  "br": -1,
  "size": 0,
  "from": "music.gdstudio.xyz"
}
```

### LyricResponse

```json
{
  "lyric": "[00:12.34]原文歌词",
  "tlyric": "",
  "from": "music.gdstudio.xyz"
}
```

字段:

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `lyric` | string | 是 | LRC 原文歌词；可能为空字符串。 |
| `tlyric` | string | 是 | LRC 翻译歌词；可能为空字符串。 |
| `from` | string | 否 | 数据来源标识。 |

### PictureResponse

```json
{
  "url": "https://example.com/cover.jpg",
  "from": "music.gdstudio.xyz"
}
```

字段:

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `url` | string | 是 | 图片地址。 |
| `from` | string | 否 | 数据来源标识。 |

## 可用接口

### 搜索音乐

```http
GET /api.php?types=search&source={source}&name={name}&count={count}&pages={pages}
```

Query 参数:

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `types` | string | 是 | 固定值 `search`。 |
| `source` | string | 否 | 音乐来源，见 `source`；省略时默认为 `netease`。 |
| `name` | string | 是 | 搜索关键词，需 URL encode。 |
| `count` | number | 否 | 返回数量；省略时当前默认约为 `20`。 |
| `pages` | number | 否 | 页码；省略时默认为第 `1` 页。 |

成功响应:

```json
[
  {
    "id": "3387145907",
    "name": "TEST",
    "artist": ["YeZippo"],
    "album": "Y3K",
    "pic_id": "109951173290929555",
    "url_id": "3387145907",
    "lyric_id": "3387145907",
    "source": "netease",
    "from": "music.gdstudio.xyz"
  }
]
```

响应体:

| 场景 | 响应 |
|---|---|
| 搜索成功 | `Song[]` |
| 无结果 | `[]` |
| 来源不支持 | `ErrorResponse` |

示例:

```bash
curl 'https://music-api.gdstudio.xyz/api.php?types=search&source=netease&name=%E6%B5%B7%E9%98%94%E5%A4%A9%E7%A9%BA&count=30'
```

### 获取播放地址

```http
GET /api.php?types=url&source={source}&id={id}&br={br}
```

Query 参数:

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `types` | string | 是 | 固定值 `url`。 |
| `source` | string | 否 | 音乐来源，通常使用 `Song.source`；省略时默认为 `netease`。 |
| `id` | string 或 number | 是 | 播放地址 ID。优先使用 `Song.url_id`；没有时使用 `Song.id`。 |
| `br` | string 或 number | 否 | 音质码率，见 `br`。 |

成功响应:

```json
{
  "url": "https://example.com/audio.mp3",
  "br": 320,
  "size": 5005485,
  "from": "music.gdstudio.xyz"
}
```

响应体:

| 场景 | 响应 |
|---|---|
| 资源可用 | `AudioUrlResponse`，且 `url` 非空。 |
| 资源不可用 | `AudioUrlResponse`，但 `url` 为空字符串，`br` 为 `-1`，`size` 为 `0`。 |
| 来源不支持 | `ErrorResponse` |

示例:

```bash
curl 'https://music-api.gdstudio.xyz/api.php?types=url&source=netease&id=3387145907&br=320'
```

### 获取歌词

```http
GET /api.php?types=lyric&source={source}&id={id}
```

Query 参数:

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `types` | string | 是 | 固定值 `lyric`。 |
| `source` | string | 否 | 音乐来源，通常使用 `Song.source`；省略时默认为 `netease`。 |
| `id` | string 或 number | 是 | 歌词 ID。优先使用 `Song.lyric_id`；没有时使用 `Song.id`。 |

成功响应:

```json
{
  "lyric": "[00:12.34]原文歌词",
  "tlyric": "",
  "from": "music.gdstudio.xyz"
}
```

响应体:

| 场景 | 响应 |
|---|---|
| 歌词可用 | `LyricResponse`，且 `lyric` 非空。 |
| 歌词不可用 | `LyricResponse`，但 `lyric` 为空字符串。 |
| 来源不支持 | `ErrorResponse` |

LRC 时间戳格式:

```text
[mm:ss.xxx]text
```

示例:

```bash
curl 'https://music-api.gdstudio.xyz/api.php?types=lyric&source=netease&id=3387145907'
```

### 获取封面图片

```http
GET /api.php?types=pic&source={source}&id={id}&size={size}
```

Query 参数:

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `types` | string | 是 | 固定值 `pic`。 |
| `source` | string | 否 | 音乐来源，通常使用 `Song.source`；省略时默认为 `netease`。 |
| `id` | string 或 number | 是 | 封面 ID，使用 `Song.pic_id`。 |
| `size` | number | 否 | 图片尺寸；省略时当前默认 `300`。 |

成功响应:

```json
{
  "url": "https://example.com/cover.jpg",
  "from": "music.gdstudio.xyz"
}
```

响应体:

| 场景 | 响应 |
|---|---|
| 封面可用 | `PictureResponse`，且 `url` 非空。 |
| 来源不支持 | `ErrorResponse` |

示例:

```bash
curl 'https://music-api.gdstudio.xyz/api.php?types=pic&source=netease&id=109951173290929555&size=500'
```

## 当前不可用接口

### 获取歌单

以下请求在当前上游 API 不可用:

```http
GET /api.php?types=playlist&id={id}&source=netease
```

但 2026-06-08 使用 `id=3778678` 和 `id=17990594711` 实测均返回:

```json
{
  "detail": "Value of `types` is not supported."
}
```

该响应的 HTTP 状态为 `400`。上游 API 首页当前也未列出歌单接口。不要依赖 `types=playlist`，除非上游 API 恢复支持或提供新的歌单接口契约。
