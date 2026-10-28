import { expect, test, type Page } from '@playwright/test'

const browserErrors = new WeakMap<Page, string[]>()

test.beforeEach(async ({ page }) => {
  const errors: string[] = []
  browserErrors.set(page, errors)
  page.on('pageerror', (error) => errors.push(error.message))
  page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()) })
  for (const path of ['providers', 'models']) {
    await page.route(`**/api/v1/${path}`, (route) => route.fulfill({ status: 200, contentType: 'application/json', body: 'null' }))
  }
})

test.afterEach(async ({ page }) => {
  expect(browserErrors.get(page)).toEqual([])
})

async function selectRole(page: Page, label: string) {
  await page.locator('.role-select').click()
  await page.locator(`.ant-select-dropdown:visible .ant-select-item-option[title="${label}"]`).click()
}

async function selectKnowledgeBase(page: Page, name: string) {
  const drawer = page.locator('.ant-drawer:visible')
  await drawer.getByRole('combobox', { name: /关联知识库/ }).click()
  await page.locator(`.ant-select-dropdown:visible .ant-select-item-option[title="${name}"]`).click()
}

test('三种角色的菜单、数据范围和直接路由权限正确', async ({ page }) => {
  await page.goto('/workbench')
  await expect(page.locator('nav[aria-label="主导航"] button')).toHaveCount(6)
  await expect(page.locator('.ant-card').filter({ hasText: '知识处理动态' })).toContainText('演示数据')

  await selectRole(page, '知识库管理人员')
  await expect(page).toHaveURL(/\/workbench$/)
  await expect(page.locator('nav[aria-label="主导航"] button')).toHaveCount(5)
  await expect(page.locator('nav[aria-label="主导航"]')).not.toContainText('模型服务')
  await page.goto('/knowledge')
  await expect(page.locator('.knowledge-card')).toHaveCount(4)
  await page.goto('/models')
  await expect(page.getByText('当前角色无权访问此模块')).toBeVisible()

  await selectRole(page, '使用者')
  await expect(page.locator('nav[aria-label="主导航"] button')).toHaveCount(3)
  await page.goto('/applications')
  await expect(page.locator('.assistant-card')).toHaveCount(2)
  await expect(page.getByRole('button', { name: /创建问答应用/ })).toHaveCount(0)
  await page.goto('/logs')
  await expect(page.getByText('当前角色无权访问此模块')).toBeVisible()
})

test('新建知识库、示例导入、索引、检索、分块编辑和重建形成闭环', async ({ page }) => {
  await page.goto('/knowledge')
  await page.getByRole('button', { name: /新建知识库/ }).click()
  await page.getByPlaceholder('例如：产品与技术文档').fill('验收测试知识库')
  await page.getByRole('button', { name: '创建知识库', exact: true }).click()
  await expect(page).toHaveURL(/\/knowledge\/kb-/)
  await expect(page.getByRole('heading', { name: '文件与构建任务' })).toBeVisible()

  await page.locator('.knowledge-content .page-heading').getByRole('button', { name: /导入知识/ }).click()
  await page.getByRole('button', { name: /使用示例资料体验流程/ }).click()
  await expect(page.locator('.import-footer')).toContainText('2 个有效文件')
  await page.getByRole('button', { name: '下一步', exact: true }).click()
  await page.getByRole('button', { name: '生成分块预览', exact: true }).click()
  await expect(page.locator('.import-step')).toContainText('报销申请')
  await page.getByRole('button', { name: '下一步', exact: true }).click()
  await page.getByRole('button', { name: '确认并构建索引', exact: true }).click()
  await expect(page.locator('.workspace-summary')).toContainText('2 份已索引', { timeout: 20_000 })

  await page.getByRole('button', { name: /检索测试/ }).click()
  await page.getByRole('button', { name: /试一试：差旅报销需要哪些材料/ }).click()
  await expect(page.locator('.retrieval-result').first()).toBeVisible()
  await expect(page.locator('.retrieval-result').first()).toContainText('报销')

  await page.getByRole('button', { name: /分块预览/ }).click()
  await page.locator('.chunk-item').first().getByRole('button', { name: /编辑/ }).click()
  await page.getByLabel('分块正文').fill('验收修订内容：报销必须附带验收专用凭证。')
  await page.getByRole('button', { name: '保存修改', exact: true }).click()
  await expect(page.locator('.knowledge-content > .ant-alert')).toContainText('等待重新索引')
  await page.getByRole('button', { name: '重建待处理索引', exact: true }).click()
  await expect(page.locator('.knowledge-content > .ant-alert')).toContainText('所有分块均已索引', { timeout: 20_000 })
  await expect(page.locator('.chunk-item').first()).toContainText('验收专用凭证')
})

test('问答应用创建发布后可以对话、查看引用并生成日志', async ({ page }) => {
  await page.goto('/applications')
  await page.getByRole('button', { name: /创建问答应用/ }).click()
  const drawer = page.locator('.ant-drawer:visible')
  await drawer.getByPlaceholder('例如：员工服务助手').fill('验收问答助手')
  await selectKnowledgeBase(page, '特色菜知识库')
  await drawer.getByRole('switch', { name: '发布到在线对话', exact: true }).click()
  await drawer.getByRole('button', { name: '保存应用', exact: true }).click()
  const card = page.locator('.assistant-card').filter({ hasText: '验收问答助手' })
  await expect(card).toContainText('已发布')
  await card.getByRole('button', { name: /开始对话/ }).click()

  await expect(page.locator('.chat-toolbar')).toContainText('验收问答助手')
  await page.getByRole('button', { name: /过桥米线有哪些主要食材/ }).click()
  await expect(page.locator('.message.assistant')).toContainText('根据「过桥米线」中的资料', { timeout: 6000 })
  await page.locator('.citation-buttons button').first().click()
  await expect(page.locator('.ant-drawer-title')).toHaveText('引用来源')
  await expect(page.locator('.ant-drawer:visible')).toContainText('云南传统名菜百科.pdf')
  await page.keyboard.press('Escape')

  await page.goto('/logs')
  await expect(page.locator('tbody')).toContainText('过桥米线有哪些主要食材？')
  const row = page.locator('tbody tr').filter({ hasText: '过桥米线有哪些主要食材？' }).first()
  await row.getByRole('button', { name: '查看', exact: true }).click()
  await expect(page.locator('.ant-drawer-title')).toHaveText('请求链路详情')
  await expect(page.locator('.ant-drawer:visible')).toContainText('输入 Tokens')
})

test('模型新增编辑删除及引用中的模型编辑保护有效', async ({ page }) => {
  await page.goto('/models')
  await page.getByRole('button', { name: /添加模型/ }).click()
  let drawer = page.locator('.ant-drawer:visible')
  await drawer.getByPlaceholder('服务商提供的模型 ID').fill('acceptance/test-llm')
  await drawer.getByRole('button', { name: '保存模型', exact: true }).click()
  let row = page.locator('tbody tr').filter({ hasText: 'acceptance/test-llm' })
  await expect(row).toHaveCount(1)

  await row.getByRole('button', { name: '编辑', exact: true }).click()
  drawer = page.locator('.ant-drawer:visible')
  await drawer.getByPlaceholder('服务商提供的模型 ID').fill('acceptance/test-llm-renamed')
  await drawer.getByRole('button', { name: '保存模型', exact: true }).click()
  row = page.locator('tbody tr').filter({ hasText: 'acceptance/test-llm-renamed' })
  await expect(row).toHaveCount(1)
  await row.getByRole('button', { name: '删除模型acceptance/test-llm-renamed', exact: true }).click()
  await page.locator('.ant-popconfirm:visible .ant-btn-primary').click()
  await expect(row).toHaveCount(0)

  const referenced = page.locator('tbody tr').filter({ hasText: 'qwen-plus' }).first()
  await referenced.getByRole('button', { name: '编辑', exact: true }).click()
  drawer = page.locator('.ant-drawer:visible')
  await drawer.getByPlaceholder('服务商提供的模型 ID').fill('broken/model-reference')
  await drawer.getByRole('button', { name: '保存模型', exact: true }).click()
  await expect(page.locator('.ant-message')).toContainText('不能更改名称、类型、向量维度或停用')
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('knowledge-hub-workspace-v3')!))
  expect(saved.models.some((model: { name: string }) => model.name === 'qwen-plus')).toBe(true)
  expect(saved.models.some((model: { name: string }) => model.name === 'broken/model-reference')).toBe(false)
})

test('390px 移动端主要页面无整页横向溢出', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/workbench')
  await expect(page.getByRole('heading', { name: '把分散的资料，变成随时可用的知识。' })).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
  await page.getByRole('button', { name: '展开模块导航', exact: true }).click()
  await expect(page.locator('.hub')).toHaveClass(/nav-open/)
  await page.locator('nav[aria-label="主导航"]').getByRole('button', { name: /在线对话/ }).click()
  await expect(page.locator('.hub')).not.toHaveClass(/nav-open/)
  await expect(page.locator('.chat-empty')).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)

  for (const path of ['/knowledge/cuisine?tab=chunks', '/models', '/applications', '/logs']) {
    await page.goto(path)
    await expect(page.locator('.hub-main')).toBeVisible()
    const width = await page.evaluate(() => ({ content: document.documentElement.scrollWidth, viewport: window.innerWidth }))
    expect(width.content, `${path} should not overflow horizontally`).toBeLessThanOrEqual(width.viewport)
  }
})

test('重复模型名称会被阻止，避免引用关系歧义', async ({ page }) => {
  await page.goto('/models')
  await page.getByRole('button', { name: /添加模型/ }).click()
  const drawer = page.locator('.ant-drawer:visible')
  await drawer.getByPlaceholder('服务商提供的模型 ID').fill('qwen-plus')
  await drawer.getByRole('button', { name: '保存模型', exact: true }).click()
  await expect(page.locator('.ant-message')).toContainText('模型名称已存在')
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('knowledge-hub-workspace-v3')!))
  expect(saved.models.filter((model: { name: string }) => model.name === 'qwen-plus')).toHaveLength(1)
})

test('构建中的文档不能删除并留下失控任务', async ({ page }) => {
  await page.goto('/knowledge/company-policy?tab=files')
  const row = page.locator('tbody tr').filter({ hasText: '采购审批流程图.png' })
  await row.getByRole('button', { name: '重试', exact: true }).click()
  await expect(row).toContainText('构建中')
  await row.getByRole('button', { name: '删除采购审批流程图.png', exact: true }).click()
  await page.locator('.ant-popconfirm:visible .ant-btn-primary').click()
  await expect(page.locator('.ant-message')).toContainText('正在构建')
  await expect(row).toHaveCount(1)
})

test('停止生成后不写入回答和日志，并可继续提问', async ({ page }) => {
  await page.goto('/chat?assistant=food-assistant')
  await page.getByRole('button', { name: /过桥米线有哪些主要食材/ }).click()
  await page.getByRole('button', { name: /停止生成/ }).click()
  await page.waitForTimeout(1700)
  await expect(page.locator('.message.assistant')).toHaveCount(0)
  let saved = await page.evaluate(() => JSON.parse(localStorage.getItem('knowledge-hub-workspace-v3')!))
  expect(saved.logs).toHaveLength(2)
  await page.getByLabel('输入问题').fill('汽锅鸡使用什么器皿烹制？')
  await page.getByRole('button', { name: /发送/ }).click()
  await expect(page.locator('.message.assistant')).toHaveCount(1, { timeout: 6000 })
  saved = await page.evaluate(() => JSON.parse(localStorage.getItem('knowledge-hub-workspace-v3')!))
  expect(saved.logs).toHaveLength(3)
})

test('无命中回答不产生引用，多轮问答保持会话和 Token 日志一致', async ({ page }) => {
  await page.goto('/chat?assistant=food-assistant')
  await page.getByLabel('输入问题').fill('量子计算芯片的制造工艺是什么？')
  await page.getByRole('button', { name: /发送/ }).click()
  await expect(page.locator('.message.assistant')).toContainText('没有找到足够依据', { timeout: 6000 })
  await expect(page.locator('.citation-buttons button')).toHaveCount(0)
  let saved = await page.evaluate(() => JSON.parse(localStorage.getItem('knowledge-hub-workspace-v3')!))
  expect(saved.logs[0].citations).toBe(0)

  await page.getByLabel('输入问题').fill('过桥米线有哪些主要食材？')
  await page.getByRole('button', { name: /发送/ }).click()
  await expect(page.locator('.message.assistant')).toHaveCount(2, { timeout: 6000 })
  await expect(page.locator('.message.user')).toHaveCount(2)
  saved = await page.evaluate(() => JSON.parse(localStorage.getItem('knowledge-hub-workspace-v3')!))
  expect(saved.sessions).toHaveLength(1)
  expect(saved.sessions[0].messages).toHaveLength(4)
  expect(saved.logs[0].input + saved.logs[0].output).toBe(saved.sessions[0].messages[3].tokens)
})

test('历史会话可恢复对应应用，删除当前会话后回到新对话', async ({ page }) => {
  await page.goto('/chat?assistant=food-assistant')
  await page.getByRole('button', { name: /过桥米线有哪些主要食材/ }).click()
  await expect(page.locator('.message.assistant')).toHaveCount(1, { timeout: 6000 })
  await page.getByRole('button', { name: /新建对话/ }).click()
  await page.getByRole('combobox', { name: '选择问答应用' }).click()
  await page.locator('.ant-select-dropdown:visible .ant-select-item-option[title="员工服务助手"]').click()
  await page.getByLabel('输入问题').fill('报销需要准备哪些材料？')
  await page.getByRole('button', { name: /发送/ }).click()
  await expect(page.locator('.message.assistant')).toHaveCount(1, { timeout: 6000 })

  await page.locator('.session-item button').filter({ hasText: '过桥米线有哪些主要食材？' }).click()
  await expect(page.locator('.chat-toolbar')).toContainText('地方饮食知识助手')
  await expect(page.locator('.message.user .message-text')).toHaveText('过桥米线有哪些主要食材？')
  await expect(page.locator('.message.assistant')).toHaveCount(1)
  await page.getByRole('button', { name: /删除会话过桥米线有哪些主要食材/ }).click()
  await page.locator('.ant-popconfirm:visible .ant-btn-primary').click()
  await expect(page.locator('.chat-empty')).toBeVisible()
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('knowledge-hub-workspace-v3')!))
  expect(saved.sessions).toHaveLength(1)
})

test('生成过程中切换应用会取消旧回答且不写入日志', async ({ page }) => {
  await page.goto('/chat?assistant=food-assistant')
  await page.getByRole('button', { name: /过桥米线有哪些主要食材/ }).click()
  await page.getByRole('combobox', { name: '选择问答应用' }).click()
  await page.locator('.ant-select-dropdown:visible .ant-select-item-option[title="员工服务助手"]').click()
  await expect(page.locator('.chat-toolbar')).toContainText('员工服务助手')
  await page.waitForTimeout(1700)
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('knowledge-hub-workspace-v3')!))
  expect(saved.logs).toHaveLength(2)
  expect(saved.sessions[0].messages).toHaveLength(1)
  await expect(page.locator('.message.assistant')).toHaveCount(0)
})

test('草稿应用不能通过对话 URL 绕过发布状态', async ({ page }) => {
  await page.goto('/chat?assistant=product-assistant')
  await expect(page.getByRole('heading', { name: '选择一个已发布的问答应用' })).toBeVisible()
  await expect(page.locator('.suggestion-grid button')).toHaveCount(0)
  await page.getByLabel('输入问题').fill('尝试调用草稿应用')
  await expect(page.getByRole('button', { name: /发送/ })).toBeDisabled()
})

test('包含未开放知识库的应用不能发布', async ({ page }) => {
  await page.goto('/applications')
  await page.getByRole('button', { name: /创建问答应用/ }).click()
  const drawer = page.locator('.ant-drawer:visible')
  await drawer.getByPlaceholder('例如：员工服务助手').fill('未开放知识测试应用')
  await selectKnowledgeBase(page, '合同与合规资料')
  await drawer.getByRole('switch', { name: '发布到在线对话', exact: true }).click()
  await drawer.getByRole('button', { name: '保存应用', exact: true }).click()
  await expect(page.locator('.ant-message')).toContainText('允许问答应用使用')
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('knowledge-hub-workspace-v3')!))
  expect(saved.assistants.some((app: { name: string }) => app.name === '未开放知识测试应用')).toBe(false)
})

test('空知识库切换向量模型不会创建空构建任务', async ({ page }) => {
  await page.goto('/knowledge')
  await page.getByRole('button', { name: /新建知识库/ }).click()
  await page.getByPlaceholder('例如：产品与技术文档').fill('空库任务测试')
  await page.getByRole('button', { name: '创建知识库', exact: true }).click()
  await page.getByRole('button', { name: /知识库设置/ }).click()
  const drawer = page.locator('.ant-drawer:visible')
  await drawer.getByRole('combobox', { name: /Embedding 模型/ }).click()
  await page.locator('.ant-select-dropdown:visible .ant-select-item-option[title="qwen3-embedding · OpenRouter"]').click()
  await drawer.getByRole('button', { name: /保\s*存/ }).click()
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('knowledge-hub-workspace-v3')!))
  expect(saved.tasks).toHaveLength(1)
  expect(saved.knowledge.find((kb: { name: string }) => kb.name === '空库任务测试').embedding).toBe('qwen3-embedding')
})

test('删除失败文档会同步清理关联任务', async ({ page }) => {
  await page.goto('/knowledge/company-policy?tab=files')
  const row = page.locator('tbody tr').filter({ hasText: '采购审批流程图.png' })
  await row.getByRole('button', { name: '删除采购审批流程图.png', exact: true }).click()
  await page.locator('.ant-popconfirm:visible .ant-btn-primary').click()
  await expect(row).toHaveCount(0)
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('knowledge-hub-workspace-v3')!))
  expect(saved.tasks.some((task: { fileIds: string[] }) => task.fileIds.includes('d5'))).toBe(false)
  expect(saved.chunks.some((chunk: { documentId: string }) => chunk.documentId === 'd5')).toBe(false)
})

test('已发布应用使用的知识库不能直接关闭问答开放状态', async ({ page }) => {
  await page.goto('/knowledge/cuisine?tab=files')
  await page.getByRole('button', { name: /知识库设置/ }).click()
  const drawer = page.locator('.ant-drawer:visible')
  await drawer.getByRole('switch', { name: '允许问答应用使用', exact: true }).click()
  await drawer.getByRole('button', { name: /保\s*存/ }).click()
  await expect(page.locator('.ant-message')).toContainText('已发布应用')
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('knowledge-hub-workspace-v3')!))
  expect(saved.knowledge.find((kb: { id: string }) => kb.id === 'cuisine').published).toBe(true)
})

test('多知识库问答日志保留全部来源并可按任一知识库筛选', async ({ page }) => {
  await page.goto('/applications')
  await page.getByRole('button', { name: /创建问答应用/ }).click()
  const drawer = page.locator('.ant-drawer:visible')
  await drawer.getByPlaceholder('例如：员工服务助手').fill('多库来源验收助手')
  await selectKnowledgeBase(page, '特色菜知识库')
  await selectKnowledgeBase(page, '企业制度与员工服务')
  await drawer.getByRole('switch', { name: '发布到在线对话', exact: true }).click()
  await drawer.getByRole('button', { name: '保存应用', exact: true }).click()
  const card = page.locator('.assistant-card').filter({ hasText: '多库来源验收助手' })
  await card.getByRole('button', { name: /开始对话/ }).click()
  await page.getByRole('button', { name: /过桥米线有哪些主要食材/ }).click()
  await expect(page.locator('.message.assistant')).toContainText('根据「过桥米线」中的资料', { timeout: 6000 })

  await page.goto('/logs')
  const row = page.locator('tbody tr').filter({ hasText: '过桥米线有哪些主要食材？' }).first()
  await expect(row).toContainText('特色菜知识库、企业制度与员工服务')
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('knowledge-hub-workspace-v3')!))
  expect(saved.logs[0].kbIds).toEqual(['cuisine', 'company-policy'])
  await page.locator('.table-toolbar .ant-select').click()
  await page.locator('.ant-select-dropdown:visible .ant-select-item-option[title="企业制度与员工服务"]').click()
  await expect(row).toBeVisible()
})

test('真实 Markdown 与 CSV 文件可通过选择、校验、预览、构建和检索闭环', async ({ page }) => {
  await page.goto('/knowledge')
  await page.getByRole('button', { name: /新建知识库/ }).click()
  await page.getByPlaceholder('例如：产品与技术文档').fill('真实文件验收知识库')
  await page.getByRole('button', { name: '创建知识库', exact: true }).click()
  await page.locator('.knowledge-content .page-heading').getByRole('button', { name: /导入知识/ }).click()

  const drawer = page.locator('.ant-drawer:visible')
  await drawer.locator('input[type="file"]').setInputFiles([
    {
      name: '验收笔记.md',
      mimeType: 'text/markdown',
      buffer: Buffer.from('# 曜石项目\n\n曜石项目的验收口令是“星河可信检索”，用于验证真实 Markdown 内容进入分块。'),
    },
    {
      name: '验收清单.csv',
      mimeType: 'text/csv',
      buffer: Buffer.from('项目,负责人,验收标准\n曜石项目,林岚,星河可信检索'),
    },
    { name: '不支持的程序.exe', mimeType: 'application/octet-stream', buffer: Buffer.from('invalid') },
  ])
  await expect(drawer.locator('.import-footer')).toContainText('2 个有效文件')
  await expect(drawer).toContainText('不支持此文件格式')
  await drawer.getByRole('button', { name: '移除不支持的程序.exe', exact: true }).click()
  await drawer.getByRole('button', { name: '下一步', exact: true }).click()
  await drawer.getByRole('button', { name: '生成分块预览', exact: true }).click()
  await expect(drawer.locator('.import-step')).toContainText('星河可信检索')
  await expect(drawer.locator('.import-step')).toContainText('林岚')
  await drawer.getByRole('button', { name: '下一步', exact: true }).click()
  await drawer.getByRole('button', { name: '确认并构建索引', exact: true }).click()
  await expect(page.locator('.workspace-summary')).toContainText('2 份已索引', { timeout: 20_000 })

  await page.getByRole('button', { name: /检索测试/ }).click()
  await page.getByPlaceholder('输入一个真实业务问题').fill('曜石项目的验收口令是什么？')
  await page.locator('.retrieval-layout').getByRole('button', { name: /测试检索/ }).click()
  await expect(page.locator('.retrieval-result').first()).toContainText('星河可信检索')
})

test('连接后端后服务商、模型保存和模型测试均走真实 API', async ({ page }) => {
  const providers: object[] = []
  const models: object[] = []
  await page.route('**/api/v1/providers', async (route) => {
    if (route.request().method() === 'GET') {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(providers) })
      return
    }
    const body = route.request().postDataJSON()
    const provider = { id: 'provider-tongyi', kind: body.kind, name: body.name, base_url: body.base_url, configured: Boolean(body.api_key), enabled: true }
    providers.push(provider)
    await route.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify(provider) })
  })
  await page.route('**/api/v1/models', async (route) => {
    if (route.request().method() === 'GET') {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(models) })
      return
    }
    const body = route.request().postDataJSON()
    const model = { id: 'model-ocr', provider_id: body.provider_id, remote_model_id: body.remote_model_id, capability: body.capability, dimensions: body.dimensions || null, enabled: body.enabled }
    models.push(model)
    await route.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify(model) })
  })
  await page.route('**/api/v1/models/model-ocr/test', (route) => route.fulfill({
    status: 200, contentType: 'application/json',
    body: JSON.stringify({ success: true, duration_ms: 128, input_tokens: 3, output_tokens: 1, usage_source: 'provider' }),
  }))

  await page.goto('/models')
  await expect(page.locator('.page > .ant-alert')).toContainText('已连接 FastAPI')
  await page.getByRole('button', { name: '配置通义百炼', exact: true }).click()
  let drawer = page.locator('.ant-drawer:visible')
  await drawer.getByPlaceholder('输入真实 API Key').fill('e2e-secret-not-a-real-key')
  await drawer.getByRole('button', { name: '保存配置', exact: true }).click()
  await expect(page.locator('.ant-message')).toContainText('密钥由后端加密保管')
  await expect(page.locator('.provider-grid')).toContainText('已配置 · 后端')

  await page.getByRole('button', { name: /添加模型/ }).click()
  drawer = page.locator('.ant-drawer:visible')
  await drawer.getByPlaceholder('服务商提供的模型 ID').fill('qwen-vl-ocr-latest')
  await drawer.getByRole('button', { name: '保存模型', exact: true }).click()
  await expect(page.locator('.ant-message')).toContainText('模型配置已保存到后端')
  const row = page.locator('tbody tr').filter({ hasText: 'qwen-vl-ocr-latest' })
  await expect(row).toHaveCount(1)
  await row.getByRole('button', { name: '测试', exact: true }).click()
  await expect(page.locator('.ant-message')).toContainText('真实连接测试通过 · 128 ms')
  expect(providers).toHaveLength(1)
  expect(models).toHaveLength(1)
  expect(JSON.stringify(providers)).not.toContain('e2e-secret-not-a-real-key')
})

test('图片经真实 OCR 异步链路识别后才进入分块并保留来源', async ({ page }) => {
  const provider = { id: 'provider-tongyi', kind: 'tongyi', name: '通义百炼', base_url: 'https://dashscope.aliyuncs.com/compatible-mode/v1', configured: true, enabled: true }
  const model = { id: 'model-ocr', provider_id: provider.id, remote_model_id: 'qwen-vl-ocr-latest', capability: 'LLM', dimensions: null, enabled: true }
  await page.route('**/api/v1/providers', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([provider]) }))
  await page.route('**/api/v1/models', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([model]) }))
  const baseResult = {
    id: 'ocr-e2e', retry_of_id: null, file_name: '验收流程图.png', sha256: 'e2e', input_tokens: 20, output_tokens: 8,
    usage_source: 'provider', created_at: '2026-10-27T00:00:00Z', error_code: null,
  }
  await page.route('**/api/v1/ocr/recognize/async', (route) => route.fulfill({
    status: 202, contentType: 'application/json',
    body: JSON.stringify({ ...baseResult, status: 'queued', text: '', duration_ms: null, completed_at: null }),
  }))
  await page.route('**/api/v1/ocr/ocr-e2e', (route) => route.fulfill({
    status: 200, contentType: 'application/json',
    body: JSON.stringify({ ...baseResult, status: 'ready', text: '星河流程：提交申请后，由负责人验收并归档。', duration_ms: 320, completed_at: '2026-10-27T00:00:01Z' }),
  }))

  await page.goto('/knowledge')
  await page.getByRole('button', { name: /新建知识库/ }).click()
  await page.getByPlaceholder('例如：产品与技术文档').fill('图片 OCR 验收知识库')
  await page.getByRole('button', { name: '创建知识库', exact: true }).click()
  await page.locator('.knowledge-content .page-heading').getByRole('button', { name: /导入知识/ }).click()
  const drawer = page.locator('.ant-drawer:visible')
  await drawer.locator('input[type="file"]').setInputFiles({
    name: '验收流程图.png', mimeType: 'image/png',
    buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64'),
  })
  await drawer.getByRole('button', { name: '下一步', exact: true }).click()
  await expect(drawer.getByRole('combobox', { name: '通义 OCR 模型' })).toBeVisible()
  await drawer.locator('.import-footer').getByRole('button', { name: /生成分块预览/ }).click()
  const chunk = drawer.locator('.chunk-item').filter({ hasText: '验收流程图.png' })
  await expect(chunk).toContainText('星河流程：提交申请后，由负责人验收并归档。')
  await expect(chunk).toContainText('真实云端 OCR')
  await expect(chunk).not.toContainText('演示解析内容')

  await drawer.getByRole('button', { name: '下一步', exact: true }).click()
  await drawer.getByRole('button', { name: '确认并构建索引', exact: true }).click()
  await expect.poll(() => page.evaluate(() => {
    const state = JSON.parse(localStorage.getItem('knowledge-hub-workspace-v3')!)
    return state.documents.find((doc: { name: string }) => doc.name === '验收流程图.png')?.parser
  })).toBe('通义云端 OCR')
})
