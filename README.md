# AI 图片收集器 - 部署与使用指南

## 一、部署 Google Apps Script (GAS)

### 步骤 1：创建表格
1. 打开 [Google Sheets](https://sheets.google.com)
2. 新建一个空白表格，命名为 "AI图片收集"

### 步骤 2：部署 GAS 脚本
1. 在表格中点击 **扩展程序 → Apps Script**
2. 删除编辑器中的默认代码
3. 将 `gas_script.js` 中的全部代码粘贴进去
4. 点击 **保存** (Ctrl+S)
5. 【可选】运行 `initDataSheet()` 函数来预先创建 Data 表头

### 步骤 3：部署为 Web App
1. 点击 **部署 → 新建部署**
2. 类型选择：**Web 应用**
3. 配置：
   - **说明**：AI图片收集器
   - **执行身份**：我自己 (你的Google账号)
   - **谁可以访问**：任何人
4. 点击 **部署**
5. **复制 Web App URL**（格式如 `https://script.google.com/macros/s/xxxxx/exec`）

### 步骤 4：设置 Google Drive 文件夹（可选）
1. 在 Google Drive 中创建一个文件夹（如 "AI图片收集"）
2. 打开文件夹，从 URL 中复制文件夹 ID
   - URL 格式：`https://drive.google.com/drive/folders/XXXXX`
   - `XXXXX` 就是文件夹 ID

---

## 二、安装 Chrome 扩展

### 步骤 1：加载扩展
1. 打开 Chrome，访问 `chrome://extensions/`
2. 打开右上角 **开发者模式**
3. 点击 **加载已解压的扩展程序**
4. 选择 `AI图片收集器` 文件夹

### 步骤 2：配置扩展
1. 点击扩展图标，打开设置面板
2. 填写：
   - **GAS Web App URL**：上面步骤 3 中复制的 URL
   - **Google Sheets ID**：表格 URL 中 `/d/` 和 `/edit` 之间的部分
   - **Drive 文件夹 ID**：步骤 4 中复制的 ID（可选）
   - **默认人名**：你的名字
3. 点击 **保存设置**

---

## 三、使用方法

### 方式 1：右键收集
1. 在任意网站上找到一张AI生成的图片
2. **右键 → 收集此AI图片**
3. 弹出收集面板，图片已自动加载
4. 填写提示词、选择软件和分类
5. 点击 **发送到表格**

### 方式 2：剪贴板粘贴
1. 先复制一张图片（截图或复制网页图片）
2. 按 **Alt+C** 打开收集面板
3. 在图片区域 **Ctrl+V** 粘贴图片
4. 填写信息并发送

### 方式 3：拖拽
1. 按 Alt+C 打开面板
2. 从网页中或文件管理器中拖拽图片到面板的图片区域
3. 填写信息并发送

---

## 四、总表公式

在同一个表格中新建一个 Sheet，命名为 "总表"。

### 表头设计

| 单元格 | 内容 |
|--------|------|
| A1 | 大分类（全表显示请选全表） |
| A2 | [数据验证下拉] 全表/AI词库/MV素材/海报... |
| E1 | 小分类 |
| E2 | [手动输入标签，逗号分隔] |
| I1 | 筛选模式 |
| I2 | [数据验证下拉] 所有分类同时包含（AND）/ 任一分类包含（OR） |

### A3 单元格的汇总公式

```
=LET(
  mdata, FILTER(Data!C:I, Data!G:G <> ""),
  keys, FILTER(
    ARRAYFORMULA(TRIM(SPLIT(A2 & "," & E2, ","))),
    ARRAYFORMULA(LEN(TRIM(SPLIT(A2 & "," & E2, ","))) > 0)
  ),
  mode, I2,
  isAll, COUNTIF(keys, "全表") > 0,
  and_res, BYROW(mdata, LAMBDA(r,
    REDUCE(TRUE, keys, LAMBDA(a, b,
      IF(b = "全表", a, a * REGEXMATCH(INDEX(r, 7), b))
    ))
  )),
  or_res, IF(COUNTA(keys) = 0,
    SEQUENCE(ROWS(mdata), 1, 1, 0) + TRUE,
    BYROW(mdata, LAMBDA(r,
      REGEXMATCH(INDEX(r, 7), TEXTJOIN("|", TRUE, FILTER(keys, keys <> "全表")))
    ))
  ),
  picked, IF(mode = "所有分类同时包含（AND）", and_res, or_res),
  final, IF(isAll, mdata, FILTER(mdata, picked)),
  final_display, {INDEX(final,,4), INDEX(final,,5), INDEX(final,,1)},
  result, WRAPROWS(FLATTEN(final_display), 24),
  IFERROR(IF(COUNTA(result) = 0, "没有找到匹配的结果。", result), "没有找到匹配的结果。")
)
```

**说明：**
- `final_display` 中的列选择：第4列=图片链接, 第5列=生成图, 第1列=软件
- `WRAPROWS(..., 24)` 表示每行展示 24/3=8 组（图片+提示词+来源）
- 可以根据需要调整 WRAPROWS 的第二个参数来控制每行的列数

### 数据验证设置
- A2: 在 "数据" → "数据验证" 中创建下拉列表
  - 值：`全表,AI词库,MV素材,海报,壁纸,写真,插画,产品图,Logo,概念设计`
- I2: 数据验证下拉
  - 值：`所有分类同时包含（AND）,任一分类包含（OR）`

---

## 五、故障排查

| 问题 | 解决方法 |
|------|----------|
| 发送时提示"请先配置 GAS URL" | 在扩展设置中填写完整的 Web App URL |
| GAS 返回权限错误 | 确保 GAS 部署时选择了"任何人"可访问 |
| 图片不显示在表格中 | 检查 Drive 文件夹共享权限是否开启 |
| 右键菜单不出现 | 刷新页面或重新加载扩展 |
| =IMAGE() 显示错误 | 确认图片链接使用 `drive.google.com/uc?export=view&id=` 格式 |

---

## 六、更新 GAS 脚本

如果修改了 GAS 代码，需要重新部署：
1. Apps Script 中修改代码
2. **部署 → 管理部署 → 编辑（铅笔图标）**
3. 版本选择 **新版本**
4. 点击 **部署**
5. URL 保持不变，无需修改扩展设置
