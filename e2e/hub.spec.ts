import { expect, test, type Page } from '@playwright/test'

const browserErrors = new WeakMap<Page, string[]>()

test.beforeEach(async ({ page }) => {
  const errors: string[] = []
  browserErrors.set(page, errors)
  page.on('pageerror', (error) => errors.push(error.message))
  page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()) })
  for (const path of ['providers', 'models', 'knowledge-bases']) {
    await page.route(`**/api/v1/${path}`, (route) => route.fulfill({ status: 200, contentType: 'application/json', body: 'null' }))
  }
  await page.route('**/api/v1/knowledge-bases/*/index-versions', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: '[]' }),
  )
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
  await expect(page.locator('nav[aria-label="主导航"] button')).toHaveCount(7)
  await expect(page.locator('.ant-card').filter({ hasText: '知识处理动态' })).toContainText('演示数据')

  await selectRole(page, '知识库管理人员')
  await expect(page).toHaveURL(/\/workbench$/)
  await expect(page.locator('nav[aria-label="主导航"] button')).toHaveCount(6)
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
  await page.goto('/observability')
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
  await page.getByRole('button', { name: /构建新索引版本/ }).click()
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

  for (const path of ['/knowledge/cuisine?tab=chunks', '/models', '/applications', '/logs', '/observability', '/observability/runs/run-chat-031', '/observability/errors', '/observability/usage']) {
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

test('联机 Markdown 创建、上传、持久化分块与人工编辑形成真实 API 闭环', async ({ page }) => {
  const models = [
    { id: 'embed-e2e', provider_id: 'provider-e2e', remote_model_id: 'text-embedding-v4', capability: 'Embedding', dimensions: 1024, enabled: true },
    { id: 'rank-e2e', provider_id: 'provider-e2e', remote_model_id: 'qwen3-rerank', capability: 'Rerank', dimensions: null, enabled: true },
  ]
  let created = false
  let uploaded = false
  let documentStatus = 'uploaded'
  let editedText = ''
  let queueFailure = false
  let indexReads = 0
  let activeVersionId: string | null = null
  const knowledge = {
    id: 'kb-e2e', name: '联机验收知识库', description: '真实 API 闭环', department: '企业通用', published: false, managed: true,
    embedding_model_id: 'embed-e2e', rerank_model_id: 'rank-e2e', chunk_size: 800, chunk_overlap: 120, chunk_strategy: 'structure',
    active_index_version_id: null, created_at: '2026-10-28T00:00:00Z', updated_at: '2026-10-28T00:00:00Z',
  }
  const document = () => ({
    id: 'doc-e2e', kb_id: knowledge.id, original_name: '联机研发规范.md', mime: 'text/markdown', extension: '.md', size_bytes: 96, sha256: 'e2e-sha',
    status: documentStatus, parser_version: 'markdown-v1', error_code: null, chunk_count: documentStatus === 'uploaded' ? 0 : 2,
    created_at: knowledge.created_at, updated_at: knowledge.updated_at,
  })
  const chunks = () => [1, 2].map((sequence) => ({
    id: `chunk-e2e-${sequence}`, kb_id: knowledge.id, document_id: 'doc-e2e', sequence,
    title: sequence === 1 ? '研发规范 · 验收要求' : '研发规范 · 发布流程',
    text: sequence === 1 ? editedText || '星河项目的验收口令是“持久化可信分块”。' : '发布前必须完成服务端回归并保留验收记录。',
    page_number: sequence, status: documentStatus === 'ready' ? 'ready' : documentStatus === 'processing' ? 'indexing' : 'pending_index',
    created_at: knowledge.created_at, updated_at: knowledge.updated_at,
  }))
  const indexVersion = (id: string, status: string, progress: number, errorCode: string | null = null) => ({
    id, kb_id: knowledge.id, embedding_model_id: 'embed-e2e', dimensions: 1024, chunk_size: 800, chunk_overlap: 120,
    chunk_strategy: 'structure', status, progress, total_chunks: 2, embedded_chunks: progress === 100 ? 2 : 0,
    input_tokens: null, usage_source: 'unavailable', duration_ms: status === 'active' ? 320 : null, error_code: errorCode,
    created_at: knowledge.created_at, started_at: status === 'queued' ? null : knowledge.created_at,
    completed_at: ['active', 'failed'].includes(status) ? knowledge.updated_at : null,
    activated_at: status === 'active' ? knowledge.updated_at : null,
  })
  let currentVersion: ReturnType<typeof indexVersion> | null = null
  let failedVersion: ReturnType<typeof indexVersion> | null = null
  const traceSpan = (id: string, name: string, parentId: string | null = 'trace-e2e') => ({
    id, run_id: 'index-e2e', parent_id: parentId, kind: 'stage', name, status: 'succeeded', offset_ms: 0, duration_ms: 20,
    summary: '真实知识处理活动', input: `${name} 输入摘要`, output: `${name} 输出摘要`, provider: null, model: null,
    usage: null, estimated_cost: null, attempt: 1, error_code: null, metadata: { recorded_before_index: true }, context_snapshot: null,
  })
  const buildTrace = () => ({
    run: {
      id: 'index-e2e', trace_id: 'trace-e2e', kind: 'build', name: `索引构建 · ${knowledge.name}`, target: knowledge.name,
      secondary_target: '2/2 个分块', status: 'succeeded', started_at: knowledge.created_at, duration_ms: 320, progress: 100,
      provider: '通义测试', model: 'text-embedding-v4', usage: { input: null, output: null, total: null, source: 'unavailable' },
      estimated_cost: null, cost_coverage: 0, error_code: null, query: '', answer: '',
    },
    spans: [
      traceSpan('trace-e2e', 'KnowledgeBuild Run', null),
      traceSpan('span-upload', 'Upload · 联机研发规范.md'),
      traceSpan('span-chunk', 'Chunk · 联机研发规范.md'),
      { ...traceSpan('span-embedding', 'Embedding · batch 1'), kind: 'model', provider: '通义测试', model: 'text-embedding-v4', usage: { input: null, output: null, total: null, source: 'unavailable' } },
      traceSpan('span-activate', 'ActivateIndex'),
    ],
  })
  await page.route('**/api/v1/models', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(models) }))
  await page.route('**/api/v1/knowledge-bases', async (route) => {
    if (route.request().method() === 'GET') {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(created ? [{ ...knowledge, active_index_version_id: activeVersionId, document_count: documentStatus === 'uploaded' ? 0 : 1, chunk_count: documentStatus === 'uploaded' ? 0 : 2 }] : []) })
      return
    }
    const body = route.request().postDataJSON()
    expect(body).toMatchObject({ name: knowledge.name, embedding_model_id: 'embed-e2e', rerank_model_id: 'rank-e2e' })
    created = true
    await route.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify({ ...knowledge, document_count: 0, chunk_count: 0 }) })
  })
  await page.route('**/api/v1/knowledge-bases/kb-e2e/documents', async (route) => {
    if (route.request().method() === 'GET') {
      if (currentVersion?.status === 'queued' && indexReads >= 1) {
        currentVersion = indexVersion('index-e2e', 'active', 100)
        activeVersionId = currentVersion.id
        documentStatus = 'ready'
      }
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(uploaded ? [document()] : []) })
      return
    }
    uploaded = true
    documentStatus = 'uploaded'
    await route.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify(document()) })
  })
  await page.route('**/api/v1/documents/doc-e2e/preview', async (route) => {
    const body = route.request().postDataJSON()
    expect(body).toMatchObject({ chunk_size: 800, chunk_overlap: 120, chunk_strategy: 'structure' })
    documentStatus = 'pending_index'
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ document: document(), chunks: chunks() }) })
  })
  await page.route('**/api/v1/documents/doc-e2e/chunks', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(chunks()) }))
  await page.route('**/api/v1/chunks/chunk-e2e-1', async (route) => {
    editedText = route.request().postDataJSON().text
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(chunks()[0]) })
  })
  await page.route('**/api/v1/knowledge-bases/kb-e2e/index-versions', async (route) => {
    if (route.request().method() === 'POST') {
      if (queueFailure) {
        failedVersion = indexVersion('index-e2e-failed', 'failed', 0, 'INDEX_QUEUE_UNAVAILABLE')
        await route.fulfill({
          status: 503, contentType: 'application/json',
          body: JSON.stringify({ error: { code: 'INDEX_QUEUE_UNAVAILABLE', message: '索引任务暂时无法提交，请稍后重试', retryable: true, details: { index_version_id: failedVersion.id } } }),
        })
        return
      }
      indexReads = 0
      currentVersion = indexVersion('index-e2e', 'queued', 0)
      if (!activeVersionId) documentStatus = 'processing'
      await route.fulfill({ status: 202, contentType: 'application/json', body: JSON.stringify(currentVersion) })
      return
    }
    if (currentVersion?.status === 'queued') {
      indexReads += 1
      if (indexReads >= 2) {
        currentVersion = indexVersion('index-e2e', 'active', 100)
        activeVersionId = currentVersion.id
        documentStatus = 'ready'
      }
    }
    const versions = [failedVersion, currentVersion].filter(Boolean)
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(versions) })
  })
  await page.route('**/api/v1/observability/runs/index-e2e', (route) => route.fulfill({
    status: 200, contentType: 'application/json', body: JSON.stringify(buildTrace()),
  }))
  await page.route('**/api/v1/knowledge-bases/kb-e2e/retrieval', async (route) => {
    expect(route.request().postDataJSON()).toMatchObject({ query: '报销需要哪些材料？', top_k: 5, candidate_k: 20, rerank: true })
    await route.fulfill({
      status: 200, contentType: 'application/json', body: JSON.stringify({
        index_version_id: 'index-e2e', candidate_count: 2, duration_ms: 36, embedding_duration_ms: 12, rerank_duration_ms: 8,
        results: [{ chunk_id: 'chunk-e2e-1', document_id: 'doc-e2e', document_name: '联机研发规范.md', sequence: 1, title: '研发规范 · 验收要求', text: '人工验收修订：服务端分块内容已更新。', page_number: 1, vector_score: 0.82, rerank_score: 0.96 }],
      }),
    })
  })

  await page.goto('/knowledge')
  await expect(page.locator('.page > .ant-alert')).toContainText('已连接 FastAPI')
  await page.getByRole('button', { name: /新建知识库/ }).click()
  await page.getByPlaceholder('例如：产品与技术文档').fill(knowledge.name)
  await page.getByRole('button', { name: '创建知识库', exact: true }).click()
  await expect(page).toHaveURL(/\/knowledge\/kb-e2e/)
  await page.locator('.knowledge-content .page-heading').getByRole('button', { name: /导入知识/ }).click()
  const drawer = page.locator('.ant-drawer:visible')
  await drawer.locator('input[type="file"]').setInputFiles({
    name: '联机研发规范.md', mimeType: 'text/markdown',
    buffer: Buffer.from('# 验收要求\n\n星河项目的验收口令是“持久化可信分块”。\n\n# 发布流程\n\n发布前必须完成服务端回归并保留验收记录。'),
  })
  await drawer.getByRole('button', { name: '下一步', exact: true }).click()
  await drawer.getByRole('button', { name: '生成分块预览', exact: true }).click()
  await expect(drawer.locator('.import-step')).toContainText('持久化可信分块')
  await expect(drawer.locator('.import-step')).toContainText('FastAPI · LangChain 持久化分块')
  await drawer.getByRole('button', { name: '下一步', exact: true }).click()
  await drawer.getByRole('button', { name: '保存分块（待索引）', exact: true }).click()
  await expect(page.locator('.workspace-summary')).toContainText('0 份已索引')
  await expect(page.locator('.table-card tbody')).toContainText('待索引')

  await page.getByRole('button', { name: /分块预览/ }).click()
  await page.locator('.chunk-item').first().getByRole('button', { name: /编辑/ }).click()
  await page.getByLabel('分块正文').fill('人工验收修订：服务端分块内容已更新。')
  await page.getByRole('button', { name: '保存修改', exact: true }).click()
  await expect(page.locator('.chunk-item').first()).toContainText('人工验收修订')
  expect(editedText).toBe('人工验收修订：服务端分块内容已更新。')
  await page.getByRole('button', { name: /文件与任务/ }).click()
  await expect(page.locator('.task-list')).toContainText('尚无真实索引版本')
  await page.locator('.knowledge-content .page-heading').getByRole('button', { name: /构建索引/ }).click()
  await expect(page.locator('.task-list')).toContainText('当前版本', { timeout: 10_000 })
  await expect(page.locator('.task-list')).toContainText('2/2 个分块')
  await expect(page.locator('.task-list')).toContainText('Token 用量未提供')
  await expect(page.locator('.workspace-summary')).toContainText('1 份已索引')
  await expect(page.locator('.table-card tbody')).toContainText('已索引')
  await page.getByRole('button', { name: /查看构建链路/ }).click()
  await expect(page).toHaveURL(/\/observability\/runs\/index-e2e/)
  await expect(page.locator('.obs-trace-tree')).toContainText('Upload · 联机研发规范.md')
  await expect(page.locator('.obs-trace-tree')).toContainText('Chunk · 联机研发规范.md')
  await expect(page.locator('.obs-trace-tree')).toContainText('Embedding · batch 1')
  await expect(page.locator('.obs-trace-tree')).toContainText('ActivateIndex')
  await page.goto('/knowledge/kb-e2e')
  await expect(page.locator('.task-list')).toContainText('当前版本')

  queueFailure = true
  await page.locator('.knowledge-content .page-heading').getByRole('button', { name: /构建索引/ }).click()
  await expect(page.locator('.ant-message')).toContainText('索引任务暂时无法提交')
  await expect(page.locator('.task-list')).toContainText('INDEX_QUEUE_UNAVAILABLE')
  await expect(page.locator('.task-list')).toContainText('当前版本')
  await expect(page.locator('.workspace-summary')).toContainText('1 份已索引')
  const errors = browserErrors.get(page) || []
  expect(errors.some((message) => message.includes('503 (Service Unavailable)'))).toBe(true)
  browserErrors.set(page, errors.filter((message) => !message.includes('503 (Service Unavailable)')))

  await page.getByRole('button', { name: /检索测试/ }).click()
  await page.getByLabel('真实检索问题').fill('报销需要哪些材料？')
  await page.getByRole('button', { name: /测试真实检索/ }).click()
  await expect(page.locator('.retrieval-result')).toContainText('人工验收修订：服务端分块内容已更新。')
  await expect(page.locator('.retrieval-result')).toContainText('向量 0.820')
  await expect(page.locator('.retrieval-result')).toContainText('重排 0.960')
  await expect(page.locator('.section-title.no-top')).toContainText('2 个候选')
  await page.locator('.retrieval-result').getByRole('button', { name: '查看原文' }).click()
  await expect(page.locator('.ant-drawer:visible')).toContainText('活动索引原文快照')
  await expect(page.locator('.ant-drawer:visible')).toContainText('人工验收修订：服务端分块内容已更新。')
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

test('联机应用配置、SSE 问答、不可变引用与 Token 日志形成闭环', async ({ page }) => {
  const now = '2026-10-29T00:00:00Z'
  const knowledge = {
    id: 'kb-chat-e2e', name: '联机问答知识库', description: 'SSE 验收', department: '企业通用', published: true, managed: true,
    embedding_model_id: 'embed-e2e', rerank_model_id: 'rank-e2e', chunk_size: 800, chunk_overlap: 120, chunk_strategy: 'structure',
    active_index_version_id: 'index-e2e', document_count: 1, chunk_count: 1, created_at: now, updated_at: now,
  }
  const models = [
    { id: 'llm-e2e', provider_id: 'provider-e2e', remote_model_id: 'qwen-plus', capability: 'LLM', dimensions: null, enabled: true },
    { id: 'embed-e2e', provider_id: 'provider-e2e', remote_model_id: 'text-embedding-v4', capability: 'Embedding', dimensions: 1024, enabled: true },
    { id: 'rank-e2e', provider_id: 'provider-e2e', remote_model_id: 'qwen3-rerank', capability: 'Rerank', dimensions: null, enabled: true },
  ]
  const citation = {
    id: 'citation-e2e', chunk_id: 'chunk-e2e', ordinal: 1, document_name: '报销制度.md', title: '报销材料',
    snapshot_text: '报销必须提供合规发票与出差审批单。', page_number: 1, vector_score: 0.88, rerank_score: 0.96,
  }
  let assistant: Record<string, unknown> | null = null
  let conversations: Record<string, unknown>[] = []
  let runs: Record<string, unknown>[] = []
  await page.route('**/api/v1/models', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(models) }))
  await page.route('**/api/v1/knowledge-bases', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([knowledge]) }))
  await page.route('**/api/v1/knowledge-bases/kb-chat-e2e/documents', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: '[]' }))
  await page.route('**/api/v1/knowledge-bases/kb-chat-e2e/index-versions', (route) => route.fulfill({
    status: 200, contentType: 'application/json', body: JSON.stringify([{
      id: 'index-e2e', kb_id: knowledge.id, embedding_model_id: 'embed-e2e', dimensions: 1024, chunk_size: 800,
      chunk_overlap: 120, chunk_strategy: 'structure', status: 'active', progress: 100, total_chunks: 1, embedded_chunks: 1,
      input_tokens: 3, usage_source: 'provider', duration_ms: 20, error_code: null, created_at: now, started_at: now,
      completed_at: now, activated_at: now,
    }]),
  }))
  await page.route('**/api/v1/assistants', async (route) => {
    if (route.request().method() === 'GET') {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(assistant ? [assistant] : []) })
      return
    }
    const body = route.request().postDataJSON()
    expect(body).toMatchObject({ name: '联机 SSE 助手', llm_model_id: 'llm-e2e', kb_ids: [knowledge.id], published: true })
    assistant = { ...body, id: 'assistant-e2e', managed: true, created_at: now, updated_at: now }
    await route.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify(assistant) })
  })
  await page.route('**/api/v1/assistants/assistant-e2e/conversations', async (route) => {
    if (route.request().method() === 'GET') {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(conversations) })
      return
    }
    conversations = [{ id: 'conversation-e2e', assistant_id: 'assistant-e2e', title: '新对话', created_at: now, updated_at: now }]
    await route.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify(conversations[0]) })
  })
  await page.route('**/api/v1/conversations/conversation-e2e/messages/stream', async (route) => {
    expect(route.request().postDataJSON()).toEqual({ query: '报销需要哪些材料？', role_context: 'admin' })
    conversations = [{ ...conversations[0], title: '报销需要哪些材料？', updated_at: now }]
    runs = [{
      id: 'run-e2e', conversation_id: 'conversation-e2e', assistant_id: 'assistant-e2e', assistant_name: '联机 SSE 助手',
      kb_ids: [knowledge.id], query: '报销需要哪些材料？', answer: '报销需要合规发票与出差审批单。[1]', role_context: 'admin',
      status: 'succeeded', llm_model: 'qwen-plus', input_tokens: 26, output_tokens: 12, total_tokens: 38,
      usage_source: 'provider', first_token_ms: 45, total_ms: 120, citation_count: 1, error_code: null, created_at: now,
    }]
    const events = [
      `event: meta\ndata: ${JSON.stringify({ conversation_id: 'conversation-e2e', assistant_id: 'assistant-e2e', user_message_id: 'user-e2e', answer_message_id: 'answer-e2e', run_id: 'run-e2e' })}`,
      `event: citations\ndata: ${JSON.stringify({ items: [citation] })}`,
      `event: token\ndata: ${JSON.stringify({ text: '报销需要合规发票' })}`,
      `event: token\ndata: ${JSON.stringify({ text: '与出差审批单。[1]' })}`,
      `event: done\ndata: ${JSON.stringify({ run_id: 'run-e2e', message_id: 'answer-e2e', status: 'succeeded', input_tokens: 26, output_tokens: 12, total_tokens: 38, usage_source: 'provider', first_token_ms: 45, total_ms: 120, citation_count: 1 })}`,
    ].join('\n\n') + '\n\n'
    await route.fulfill({ status: 200, headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' }, body: events })
  })
  await page.route('**/api/v1/query-runs', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(runs) }))

  await page.goto('/applications')
  await expect(page.locator('.page > .ant-alert')).toContainText('应用、会话与回答均使用服务端数据')
  await page.getByRole('button', { name: /创建问答应用/ }).click()
  const drawer = page.locator('.ant-drawer:visible')
  await drawer.getByPlaceholder('例如：员工服务助手').fill('联机 SSE 助手')
  await drawer.getByRole('combobox', { name: /关联知识库/ }).click()
  await page.locator('.ant-select-dropdown:visible .ant-select-item-option').filter({ hasText: knowledge.name }).click()
  await drawer.getByRole('switch', { name: '发布到在线对话', exact: true }).click()
  await drawer.getByRole('button', { name: '保存应用', exact: true }).click()
  const card = page.locator('.assistant-card').filter({ hasText: '联机 SSE 助手' })
  await expect(card).toContainText('已发布')
  await card.getByRole('button', { name: /开始对话/ }).click()

  await page.getByLabel('输入问题').fill('报销需要哪些材料？')
  await page.getByRole('button', { name: /发\s*送/ }).click()
  await expect(page.locator('.message.assistant .message-text')).toHaveText('报销需要合规发票与出差审批单。[1]')
  await expect(page.locator('.message-usage')).toContainText('38 Tokens')
  await expect(page.locator('.message-usage')).toContainText('服务商用量')
  await page.locator('.citation-buttons button').click()
  await expect(page.locator('.ant-drawer:visible')).toContainText('活动索引原文快照')
  await expect(page.locator('.ant-drawer:visible')).toContainText('报销必须提供合规发票与出差审批单。')
  await page.keyboard.press('Escape')

  await page.goto('/logs')
  await expect(page.locator('tbody')).toContainText('报销需要哪些材料？')
  await expect(page.locator('tbody')).toContainText('26 / 12')
  await page.locator('tbody').getByRole('button', { name: '查看', exact: true }).click()
  await expect(page.locator('.ant-drawer:visible')).toContainText('38')
  await expect(page.locator('.ant-drawer:visible')).toContainText('服务商')
  expect(runs).toHaveLength(1)
})

test('可观测总览可下钻失败运行并组合筛选', async ({ page }) => {
  await page.goto('/observability')
  await expect(page.getByRole('heading', { name: '可观测总览', exact: true })).toBeVisible()
  await expect(page.locator('.obs-demo-notice')).toContainText('非真实监控')
  await expect(page.getByRole('img', { name: '近七天运行量与失败趋势图' })).toBeVisible()
  await page.locator('.obs-metric').filter({ hasText: '运行成功率' }).click()
  await expect(page).toHaveURL(/\/observability\/runs\?status=failed$/)
  await expect(page.locator('tbody tr.ant-table-row')).toHaveCount(2)
  await page.getByRole('combobox', { name: '运行类型' }).click()
  await page.locator('.ant-select-dropdown:visible .ant-select-item-option[title="知识库构建"]').click()
  await expect(page.locator('tbody tr.ant-table-row')).toHaveCount(1)
  await expect(page.locator('tbody')).toContainText('run-build-017')
  await page.getByPlaceholder('搜索 Run ID、问题、知识库或应用').fill('不存在的关键字')
  await expect(page.getByText('没有匹配的运行记录')).toBeVisible()
})

test('对话 Trace 的调用树、最终上下文与未知用量可联动检查', async ({ page }) => {
  await page.goto('/observability/runs/run-chat-031')
  await expect(page.locator('.obs-run-summary')).toContainText('2,246')
  await expect(page.locator('.obs-conversation-summary')).toContainText('差旅报销需要哪些材料？')
  await page.locator('.obs-trace-tree').getByRole('button', { name: /LLM · stream_chat/ }).click()
  await page.getByRole('tab', { name: '调用上下文' }).click()
  await expect(page.getByText('最终发送给模型的上下文')).toBeVisible()
  await expect(page.locator('.obs-context-messages')).toContainText('费用管理制度')
  await expect(page.locator('.obs-context-panel')).toContainText('2 条最早历史')
  await page.locator('.obs-trace-tree').getByRole('button', { name: /Rerank/ }).click()
  await page.getByRole('tab', { name: '用量与异常' }).click()
  await expect(page.locator('.obs-usage-panel')).toContainText('用量或成本未知')
  await expect(page.locator('.obs-usage-panel')).toContainText('未知值不按 0')
})

test('构建 Trace 展示真实层级语义的模型、工具、Skill 与失败保护节点', async ({ page }) => {
  await page.goto('/observability/runs/run-build-015')
  await expect(page.locator('.obs-trace-tree')).toContainText('ParseDocument')
  await page.locator('.obs-trace-tree').getByRole('button', { name: /document-layout/ }).click()
  await expect(page.locator('.obs-span-heading')).toContainText('工具 Span')
  await page.getByRole('tab', { name: '调用上下文' }).click()
  await expect(page.locator('.obs-context-panel')).toContainText('构建上下文快照')
  await page.goto('/observability/runs/run-build-017')
  await expect(page.locator('.obs-run-summary')).toContainText('UPSTREAM_RATE_LIMIT')
  await page.locator('.obs-trace-tree').getByRole('button', { name: /PreserveActiveIndex/ }).click()
  await expect(page.locator('.obs-span-detail')).toContainText('继续服务 index-v11')
})

test('异常中心支持分类筛选、详情查看与原始 Trace 下钻', async ({ page }) => {
  await page.goto('/observability/errors')
  await page.getByRole('combobox', { name: '异常分类' }).click()
  await page.locator('.ant-select-dropdown:visible .ant-select-item-option[title="Harness"]').click()
  await expect(page.locator('tbody tr.ant-table-row')).toHaveCount(2)
  await expect(page.locator('tbody')).toContainText('WORKER_HEARTBEAT_DELAYED')
  await page.locator('tbody tr.ant-table-row').first().getByRole('button', { name: '详情', exact: true }).click()
  await expect(page.locator('.ant-drawer:visible')).toContainText('安全诊断信息')
  await expect(page.locator('.ant-drawer:visible')).toContainText('api_key=[EXCLUDED]')
  await page.locator('.ant-drawer:visible').getByRole('button', { name: '定位 Trace' }).click()
  await expect(page).toHaveURL(/\/observability\/runs\/run-chat-030\?span=sp-030-sse$/)
  await expect(page.locator('.obs-span-heading')).toContainText('SSE ErrorEvent')
})

test('用量成本支持分组、明细导出和新增价格规则', async ({ page }) => {
  await page.goto('/observability/usage')
  await expect(page.locator('.obs-usage-alert')).toContainText('估算成本 ≠ 服务商账单')
  await expect(page.locator('.obs-table-card').last()).toContainText('未提供')
  await page.getByRole('combobox', { name: '用量分组' }).click()
  await page.locator('.ant-select-dropdown:visible .ant-select-item-option[title="按模型"]').click()
  await expect(page.locator('.obs-usage-bars')).toContainText('qwen-plus')
  const downloadPromise = page.waitForEvent('download')
  await page.getByRole('button', { name: '导出明细' }).click()
  const download = await downloadPromise
  expect(download.suggestedFilename()).toBe('知枢-Token用量-原型.csv')
  await page.getByRole('button', { name: '新增价格规则' }).click()
  const drawer = page.locator('.ant-drawer:visible')
  await drawer.getByPlaceholder('例如：qwen-plus').fill('rerank-prototype-v1')
  await drawer.getByRole('combobox', { name: '模型能力' }).click()
  await page.locator('.ant-select-dropdown:visible .ant-select-item-option[title="Rerank"]').click()
  await drawer.getByRole('button', { name: '保存规则' }).click()
  await expect(page.locator('tbody').filter({ hasText: 'rerank-prototype-v1' })).toBeVisible()
  await expect(page.locator('.ant-message')).toContainText('本次原型会话')
})

test('联机观测读取构建 Trace、完整对话快照、异常与未知用量', async ({ page }) => {
  const now = '2026-10-31T12:00:00Z'
  const makeRun = (id: string, known: boolean, kind: 'chat' | 'build' = 'chat') => ({
    id, trace_id: `trace-${id}`, kind,
    name: kind === 'build' ? '制度索引真实构建' : known ? '报销材料真实问答' : '未知用量真实问答',
    target: kind === 'build' ? '企业制度知识库' : '员工问答助手',
    secondary_target: kind === 'build' ? 'index-real · 制度.md' : '企业制度知识库',
    status: 'succeeded', started_at: now, duration_ms: 126, progress: 100,
    provider: '通义测试', model: kind === 'build' ? 'text-embedding-v4' : 'qwen-plus',
    usage: known ? { input: kind === 'build' ? 12 : 18, output: kind === 'build' ? null : 6, total: kind === 'build' ? 12 : 24, source: 'provider' } : { input: null, output: null, total: null, source: 'unavailable' },
    estimated_cost: null, cost_coverage: 0, error_code: null,
    query: kind === 'build' ? null : known ? '报销需要哪些材料？' : '入职需要哪些材料？',
    answer: kind === 'build' ? null : '依据企业制度回答。',
  })
  const runs = [makeRun('run-real-ok', true), makeRun('run-real-unknown', false), makeRun('run-real-build', true, 'build')]
  const makeDetail = (run: ReturnType<typeof makeRun>) => {
    const root = {
      id: `root-${run.id}`, run_id: run.id, parent_id: null, kind: 'stage', name: 'Chat Run', status: 'succeeded',
      offset_ms: 0, duration_ms: 126, summary: '端到端检索增强问答', input: run.query, output: '回答成功',
      provider: null, model: null, usage: null, estimated_cost: null, attempt: 1, error_code: null,
      metadata: { capture_policy: 'summary_only' },
    }
    const context = {
      ...root, id: `context-${run.id}`, parent_id: root.id, name: 'BuildContext', offset_ms: 45, duration_ms: 8,
      summary: '构造最终模型上下文与引用编号', input: '检索结果与历史消息', output: '3 条模型消息 · 1 个引用编号',
      metadata: { message_count: 3, history_message_count: 1, dynamic_budget_enabled: false, full_snapshot_captured: run.id === 'run-real-ok' },
      context_snapshot: run.id === 'run-real-ok' ? {
        id: 'snapshot-real-ok',
        messages: [
          { role: 'system', content: '你只能依据企业知识作答。\n资料不足时明确说明。' },
          { role: 'assistant', content: '上一轮真实回答' },
          { role: 'user', content: '报销需要哪些材料？\n请列出全部材料。' },
        ],
        metadata: { context_hash: 'sha256:real-context', message_count: 3, history_limit: 12, full_input_captured: true },
        created_at: now,
      } : null,
    }
    const llm = {
      ...root, id: `llm-${run.id}`, parent_id: root.id, kind: 'model', name: 'LLM · stream_chat', offset_ms: 53, duration_ms: 65,
      summary: 'LangChain ChatOpenAI 流式生成', input: 'System + 1 条历史 + 当前问题', output: '流式回答完成',
      provider: '通义测试', model: 'qwen-plus', usage: run.usage, metadata: { first_token_ms: 30 },
    }
    return { run, spans: [root, context, llm] }
  }
  const buildRun = runs[2]
  const buildRoot = {
    id: 'root-run-real-build', run_id: buildRun.id, parent_id: null, kind: 'stage', name: 'KnowledgeBuild Run', status: 'succeeded',
    offset_ms: 0, duration_ms: 126, summary: '真实知识库索引构建', input: 'index-real · 2 个分块', output: '索引已激活',
    provider: null, model: null, usage: buildRun.usage, estimated_cost: null, attempt: 1, error_code: null,
    metadata: { index_version: 'index-real', total_chunks: 2 },
  }
  const buildDetail = { run: buildRun, spans: [
    buildRoot,
    { ...buildRoot, id: 'validate-run-real-build', parent_id: buildRoot.id, name: 'ValidateSource', duration_ms: 8, input: 'source_hash=sha256:real', output: '2 个分块校验通过', usage: null, metadata: { dimensions: 1024 } },
    { ...buildRoot, id: 'embedding-run-real-build', parent_id: buildRoot.id, name: 'Embedding Stage', offset_ms: 8, duration_ms: 70, input: '1 个 Embedding 批次', output: '1 批成功', metadata: { completed_batches: 1, total_batches: 1 } },
    { ...buildRoot, id: 'batch-run-real-build', parent_id: 'embedding-run-real-build', kind: 'model', name: 'Embedding · batch 1', offset_ms: 8, duration_ms: 60, input: '2 个分块 · 内容未采集', output: 'vector[1024] × 2', provider: '通义测试', model: 'text-embedding-v4', metadata: { chunk_range: '1–2', attempt: 1 } },
    { ...buildRoot, id: 'write-run-real-build', parent_id: buildRoot.id, name: 'VectorWrite · batch 1', offset_ms: 78, duration_ms: 20, input: '2 个向量快照', output: '2 条已写入', usage: null, metadata: { chunk_range: '1–2' } },
    { ...buildRoot, id: 'activate-run-real-build', parent_id: buildRoot.id, name: 'ActivateIndex', offset_ms: 98, duration_ms: 28, input: 'index-real', output: 'active_index_version=index-real', usage: null, metadata: { active_index: 'index-real' } },
  ] }
  await page.route('**/api/v1/models', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: '[]' }))
  await page.route('**/api/v1/knowledge-bases', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: '[]' }))
  await page.route('**/api/v1/observability/runs', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(runs) }))
  await page.route('**/api/v1/observability/runs/run-real-ok', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(makeDetail(runs[0])) }))
  await page.route('**/api/v1/observability/runs/run-real-unknown', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(makeDetail(runs[1])) }))
  await page.route('**/api/v1/observability/runs/run-real-build', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(buildDetail) }))
  await page.route('**/api/v1/observability/summary', (route) => route.fulfill({
    status: 200, contentType: 'application/json', body: JSON.stringify({
      run_count: 3, success_rate: 100, total_tokens: 36, unknown_usage_count: 1, estimated_cost: null, cost_coverage: 0,
      status_counts: { succeeded: 3 }, trend: ['10/25', '10/26', '10/27', '10/28', '10/29', '10/30', '10/31'].map((day, index) => ({ day, runs: index === 6 ? 3 : 0, failed: 0, tokens: index === 6 ? 36 : 0 })), slow_spans: [],
    }),
  }))
  await page.route('**/api/v1/observability/errors', (route) => route.fulfill({
    status: 200, contentType: 'application/json', body: JSON.stringify([{
      id: 'error-real', run_id: 'run-real-unknown', span_id: 'llm-run-real-unknown', category: '可观测自身', severity: 'warning',
      code: 'USAGE_UNAVAILABLE', message: 'LLM 服务商未返回 Token；运行保持成功。', fingerprint: 'chat/usage_unavailable',
      count: 1, first_occurred_at: now, last_occurred_at: now, retryable: false,
    }]),
  }))
  await page.route('**/api/v1/observability/errors/groups', (route) => route.fulfill({
    status: 200, contentType: 'application/json', body: JSON.stringify([{
      id: 'error-real-latest', run_id: 'run-real-unknown', span_id: 'llm-run-real-unknown', category: '可观测自身', severity: 'error',
      code: 'USAGE_UNAVAILABLE', message: '最近一次真实用量缺失。', fingerprint: 'chat/usage_unavailable',
      count: 3, affected_run_count: 2, first_occurred_at: '2026-10-30T12:00:00Z', last_occurred_at: now, retryable: false,
    }]),
  }))

  await page.goto('/observability/runs')
  await expect(page.locator('.obs-demo-notice')).toContainText('真实运行 Trace')
  await expect(page.locator('tbody tr.ant-table-row')).toHaveCount(3)
  await expect(page.locator('tbody')).toContainText('run-real-build')
  await expect(page.locator('tbody')).toContainText('24')
  await expect(page.locator('tbody')).toContainText('未提供')
  await expect(page.locator('tbody')).not.toContainText('run-build-017')

  await page.locator('tbody tr').filter({ hasText: 'run-real-build' }).getByRole('button', { name: '查看 Trace' }).click()
  await expect(page.locator('.obs-trace-tree')).toContainText('ValidateSource')
  await expect(page.locator('.obs-trace-tree')).toContainText('Embedding · batch 1')
  await expect(page.locator('.obs-trace-tree')).toContainText('VectorWrite · batch 1')
  await page.locator('.obs-trace-tree').getByRole('button', { name: /Embedding · batch 1/ }).click()
  await page.getByRole('tab', { name: '调用上下文' }).click()
  await expect(page.locator('.obs-context-panel')).toContainText('真实构建节点上下文')
  await expect(page.locator('.obs-context-panel')).toContainText('chunk_range')
  await expect(page.locator('.obs-context-panel')).not.toContainText('最终发送给模型')

  await page.goto('/observability/runs/run-real-ok')
  await expect(page.locator('.obs-run-summary')).toContainText('24')
  await page.locator('.obs-trace-tree').getByRole('button', { name: /LLM · stream_chat/ }).click()
  await page.getByRole('tab', { name: '调用上下文' }).click()
  await expect(page.locator('.obs-context-panel')).toContainText('最终发送给模型的完整上下文')
  await expect(page.locator('.obs-context-messages article')).toHaveCount(3)
  await expect(page.locator('.obs-context-messages')).toContainText('你只能依据企业知识作答。')
  await expect(page.locator('.obs-context-messages')).toContainText('上一轮真实回答')
  await expect(page.locator('.obs-context-messages')).toContainText('请列出全部材料。')
  await expect(page.locator('.obs-context-panel')).toContainText('sha256:real-context')
  await expect(page.locator('.obs-context-panel')).toContainText('history_limit')
  await expect(page.locator('.obs-context-panel')).toContainText('当前角色选择不是安全边界')
  await expect(page.locator('.obs-context-panel')).not.toContainText('420')

  await page.goto('/observability/errors')
  await expect(page.locator('tbody')).toContainText('USAGE_UNAVAILABLE')
  const groupRow = page.locator('tbody tr.ant-table-row').filter({ hasText: 'chat/usage_unavailable' })
  await expect(groupRow.locator('td').nth(4)).toHaveText('3')
  await expect(groupRow.locator('td').nth(5)).toHaveText('2')
  await groupRow.getByRole('button', { name: '详情', exact: true }).click()
  const groupDrawer = page.locator('.ant-drawer:visible')
  await expect(groupDrawer).toContainText('聚合次数')
  await expect(groupDrawer).toContainText('2 个（构建与问答去重）')
  await expect(groupDrawer).toContainText('2026-10-30 12:00:00')
  await expect(groupDrawer).toContainText('2026-10-31 12:00:00')
  await groupDrawer.getByRole('button', { name: '定位 Trace' }).click()
  await expect(page).toHaveURL(/\/observability\/runs\/run-real-unknown\?span=llm-run-real-unknown$/)
  await page.getByRole('tab', { name: '用量与异常' }).click()
  await expect(page.locator('.obs-usage-panel')).toContainText('用量或成本未知')
  await expect(page.locator('.obs-usage-panel')).toContainText('未提供')
  await page.getByRole('tab', { name: '调用上下文' }).click()
  await expect(page.locator('.obs-context-panel')).toContainText('历史 Run 未采集完整快照')

  await page.goto('/observability')
  await expect(page.locator('.obs-metrics-grid')).toContainText('36')
  await expect(page.locator('.obs-metrics-grid')).toContainText('1 次 Run 用量未知')
  await page.goto('/observability/usage')
  await expect(page.locator('.obs-usage-alert')).toContainText('不会写入服务端')
  await expect(page.locator('.obs-table-card').last()).toContainText('未知')
})
