# NovelAI Image Generation API 文档

本文档基于本仓库实测（2026-08-21）与 `https://image.novelai.net/docs/doc.json` 整理。Persistent token 必须打 **`image.novelai.net`**，不要打 `api.novelai.net`（会 `400`：`Please refresh NovelAI.net. If using a third-party tool, update to the image URL.`）。

OpenAPI 真身：`https://image.novelai.net/docs/doc.json`（`/docs/index.html` 加载这份）。

本应用封装：`services/naiPayload.ts` 组请求；Worker `/api/generate`、`/api/generate-stream`、`/api/nai/subscription` 透传 `Authorization`。

---

## 1. 基础信息

| | Zip 生图 | 流式生图 | 订阅 / 电量 / Anlas |
| :--- | :--- | :--- | :--- |
| Endpoint | `https://image.novelai.net/ai/generate-image` | `https://image.novelai.net/ai/generate-image-stream` | `https://image.novelai.net/user/subscription` |
| Method | `POST` | `POST`（GET 为 405） | `GET` |
| 成功 Content-Type | `binary/octet-stream`（zip） | `text/event-stream` | `application/json` |
| Authorization | `Bearer <pst-...>` | 同左 | 同左 |

请求体（两个生图端点共用）`Content-Type: application/json`。

本仓库模型名：

| UI | `model` |
| :--- | :--- |
| V4.5 | `nai-diffusion-4-5-full` |
| V5 | `nai-diffusion-5-full` |

V5 请求体可沿用 V4 的 `v4_prompt` / `v4_negative_prompt`，无需新必填字段。旧 Chain 无 `model` 时按 V4.5。

V5 官网会把提示词里 `"..."` / `「」` / `『』` / `“”` / `‘’` / `＂＂` 的句子自动提升成末尾 `teXt:` 块（多段空一行、**引号出现顺序倒序**，因为第一行画在画面顶部）。手写 `Text:` / `teXt:` 则不再自动抽。质量词仍含 `no text`，靠 `teXt:` 指定要写的字；本应用在 `buildGenerationPayload` 里对 V5 做同样变换。多角色默认 `use_coords: false`（AI 排位置）；手动坐标需显式打开。

---

## 2. 请求结构 (Request Payload)

| 字段名 | 类型 | 必填 | 描述 | 示例值 |
| :--- | :--- | :--- | :--- | :--- |
| `input` | String | 是 | 最终正面提示词（Base + 变量 + 模块 + Quality Tags；透明开启时追加透明词）。 | `"1girl, ..."` |
| `model` | String | 是 | 模型代号。 | `"nai-diffusion-5-full"` |
| `action` | String | 是 | 操作类型。 | `"generate"` |
| `parameters` | Object | 是 | 生成参数，见下。 | `{ ... }` |

### 2.1 Parameters

#### 基础生成参数
| 字段名 | 类型 | 描述 | 默认/常见值 |
| :--- | :--- | :--- | :--- |
| `params_version` | Number | 参数版本。V4.5 为 `3`，V5 官网为 `4`。 | `4` |
| `width` | Number | 宽度。 | `832` |
| `height` | Number | 高度。 | `1216` |
| `scale` | Number | CFG Scale。 | `5` |
| `sampler` | String | 采样器。 | `"k_euler_ancestral"` |
| `steps` | Number | 步数。 | `28` |
| `seed` | Number | 随机种子。不传或 `-1` 表示随机。 | `123456` |
| `n_samples` | Number | 张数。本应用固定 1。 | `1` |

#### V4/V4.5/V5 共用
| 字段名 | 类型 | 描述 |
| :--- | :--- | :--- |
| `skip_cfg_above_sigma` | Number \| null | Variety+：`58` 开，`null` 关。 |
| `cfg_rescale` | Number | CFG Rescale，0.0–1.0。 |
| `qualityToggle` | Boolean | UI 状态。画质词在 `input` 拼接，请求仍携带。 |
| `tag_hint_qt` | Number | V5 画质开时发 `1`（官网 Standard）。关则不发。 |
| `ucPreset` | Number | UI 状态。0 Heavy / 1 Light / 2 Furry / 3 Human / 4 None。 |
| `v4_prompt` | Object | 结构化正面提示。V5 字段名仍是 `v4_*`。 |
| `v4_negative_prompt` | Object | 结构化负面提示。 |

**`v4_prompt`：**
```json
{
  "caption": {
    "base_caption": "string",
    "char_captions": [
      { "char_caption": "1girl, blue hair", "centers": [{ "x": 0.5, "y": 0.5 }] }
    ]
  },
  "use_coords": false,
  "use_order": true
}
```

**`v4_negative_prompt`：**
```json
{
  "caption": {
    "base_caption": "string",
    "char_captions": [
      { "char_caption": "", "centers": [{ "x": 0.5, "y": 0.5 }] }
    ]
  },
  "legacy_uc": false
}
```

#### 流式
| 字段名 | 类型 | 描述 |
| :--- | :--- | :--- |
| `stream` | `"sse"` \| `"msgpack"` | 走 `/ai/generate-image-stream` 时用 `"sse"`。HTTP 层是 SSE；PNG Comment 里可能仍写 `"msgpack"`。 |

#### 透明背景（仅 V5）
官网 prompt 词：`transparent background` / `has alpha` / `alpha transparency`。本应用开启时往 `input` / `base_caption` 追加 `transparent background, has alpha`。

| 字段名 | 类型 | 描述 |
| :--- | :--- | :--- |
| `straight_alpha` | Boolean | `true` = Straight（颜色与透明分开）；`false` = Premultiplied（颜色已乘过 alpha）。 |
| `tag_hint_transparent_background` | Boolean | 告诉模型「这张要透明底」。网关不处理（OpenAPI：*Pure pass-through hint*）。 |

zip 端点和 stream 端点都能出 RGBA PNG（color type 6）。预览器常把透明合成黑底，以像素 alpha 为准。JPG 压缩会丢掉 alpha。

未测：`image_format` `"png"` \| `"webp"`。

#### Vibe
| 字段名 | 类型 | 描述 |
| :--- | :--- | :--- |
| `reference_image_multiple` | String[] | 预编码，顺序与挂载一致。 |
| `reference_strength_multiple` | Number[] | Strength。 |
| `reference_information_extracted_multiple` | Number[] | Information Extracted。 |

#### Boilerplate
| 字段名 | 值 | 描述 |
| :--- | :--- | :--- |
| `sm` / `sm_dyn` | `false` | SMEA（V4+ 不用） |
| `dynamic_thresholding` | `false` | 动态阈值 |
| `controlnet_strength` | `1` | ControlNet |
| `legacy` | `false` | 旧处理 |
| `add_original_image` | `true` | 图生图相关 |
| `uncond_scale` | `1` | 无条件 Scale |
| `noise_schedule` | `"karras"` | 噪声调度 |
| `deliberate_euler_ancestral_bug` | `false` | Euler A |
| `prefer_brownian` | `true` | 布朗噪声 |

---

## 3. 完整请求示例

V5 + 透明 Straight（zip 或 stream 体相同；stream 再加 `"stream": "sse"`）：

```json
{
  "input": "1girl, looking at viewer, transparent background, has alpha",
  "model": "nai-diffusion-5-full",
  "action": "generate",
  "parameters": {
    "params_version": 4,
    "width": 832,
    "height": 1216,
    "scale": 5,
    "sampler": "k_euler_ancestral",
    "steps": 28,
    "n_samples": 1,
    "skip_cfg_above_sigma": null,
    "cfg_rescale": 0,
    "qualityToggle": false,
    "ucPreset": 4,
    "sm": false,
    "sm_dyn": false,
    "dynamic_thresholding": false,
    "controlnet_strength": 1,
    "legacy": false,
    "add_original_image": true,
    "uncond_scale": 1,
    "noise_schedule": "karras",
    "negative_prompt": "lowres, bad anatomy, bad hands, text, error",
    "v4_prompt": {
      "caption": {
        "base_caption": "1girl, looking at viewer, transparent background, has alpha",
        "char_captions": []
      },
      "use_coords": false,
      "use_order": true
    },
    "v4_negative_prompt": {
      "caption": {
        "base_caption": "lowres, bad anatomy, bad hands, text, error",
        "char_captions": []
      },
      "legacy_uc": false
    },
    "deliberate_euler_ancestral_bug": false,
    "prefer_brownian": true,
    "straight_alpha": true,
    "tag_hint_transparent_background": true
  }
}
```

---

## 4. 响应

### 4.1 Zip（`/ai/generate-image`）

- HTTP `200`，`Content-Type: binary/octet-stream`，`Content-Disposition: attachment; filename=images.zip`。
- 包内通常只有 `image_0.png`，**没有**伴随 `.json`。
- 种子 / 模型写在 PNG `tEXt`：`Source`（如 `NovelAI Diffusion V5 0ADF9AB7`）、`Comment`（JSON，含 `model_name`、`seed`、`v4_prompt`、`straight_alpha` 等）。

### 4.2 SSE（`/ai/generate-image-stream`）

`Accept: text/event-stream`。28 steps 实测：27 条 `event: intermediate`（`step_ix` 0–26）+ 1 条 `event: final`。

```json
{
  "event_type": "intermediate",
  "samp_ix": 0,
  "step_ix": 0,
  "gen_id": 6214152,
  "sigma": 20000,
  "image": "<base64>"
}
```

- `intermediate.image`：JPEG 缩图（`/9j/...`）。
- `final.image`：全尺寸 PNG（`iVBORw0KGgo...`）。`final` 无 `step_ix` / `sigma`。
- 文档还列了 `StreamingEventTypeError`，本次未碰到。
- `EventSource` 不支持 POST，前端用 `fetch` + `ReadableStream`。Worker 必须 pipe，不能 `blob()`。

### 4.3 错误

JSON，例如：

```json
{ "statusCode": 402, "message": "Anlas depletion" }
```

---

## 5. 订阅、Anlas、V5 电量

```http
GET https://image.novelai.net/user/subscription
Authorization: Bearer <pst-...>
```

`GET /user/data` 里同一份在 `subscription`。没有独立 `/user/battery`、`/user/energy`、`/user/usage`（404）。生图响应头/zip 里没有电量。

```json
{
  "tier": 3,
  "active": true,
  "trainingStepsLeft": {
    "fixedTrainingStepsLeft": 9988,
    "purchasedTrainingSteps": 0
  },
  "usage": {
    "percent": 97,
    "isNegative": false,
    "timeUntilNextPercent": 7888
  }
}
```

| 字段 | 含义 |
| :--- | :--- |
| `trainingStepsLeft.fixedTrainingStepsLeft` | 订阅 Anlas |
| `trainingStepsLeft.purchasedTrainingSteps` | 购买 Anlas |
| `usage.percent` | 剩余电量 %（不是已消耗） |
| `usage.isNegative` | 是否透支 |
| `usage.timeUntilNextPercent` | 距 % +1 的秒数 |
| `usage` 整段缺失 | 非 Opus，不要造电量 |

Anlas = 两档之和。电量只对 **Opus + V5 + 普通分辨率 + ≤28 steps** 的免费张生效；更高分辨率/步数仍扣 Anlas。

API **不返回张数**。官网文案校准：`1% ≈ 17.3 张`，满电约 1730 张。

```
remainingImages    = round(percent * 17.3)
refillPctPerDay    = 86400 / timeUntilNextPercent
refillImagesPerDay = round(round(refillPctPerDay) * 17.3)
```

`timeUntilNextPercent = 7888` 时约 11%/天、约 190 张/天；空到满约一周。

本应用：`services/naiAccount.ts`；Worker `GET /api/nai/subscription`。
