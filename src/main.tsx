import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { App as AntApp, ConfigProvider } from 'antd'
import zhCN from 'antd/locale/zh_CN'
import dayjs from 'dayjs'
import 'dayjs/locale/zh-cn'
import App from './HubApp'
import './hub.css'

dayjs.locale('zh-cn')

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ConfigProvider
      locale={zhCN}
      theme={{
        token: {
          colorPrimary: '#3568f4',
          colorInfo: '#2563eb',
          colorSuccess: '#15803d',
          colorWarning: '#b45309',
          colorError: '#b42318',
          colorText: '#202a3d',
          colorTextSecondary: '#64748b',
          colorBgLayout: '#f5f7fb',
          colorBorderSecondary: '#e2e8f0',
          borderRadius: 8,
          borderRadiusLG: 10,
          fontFamily:
            "Inter, ui-sans-serif, -apple-system, BlinkMacSystemFont, 'Segoe UI', 'PingFang SC', 'Microsoft YaHei', sans-serif",
        },
        components: {
          Button: { controlHeight: 36, fontWeight: 500, primaryShadow: 'none' },
          Card: { headerBg: '#ffffff' },
          Layout: { bodyBg: '#f6f8fb', siderBg: '#ffffff', headerBg: '#ffffff' },
          Menu: { itemBorderRadius: 8, itemHeight: 44 },
          Table: { headerBg: '#f8fafc', headerColor: '#475569' },
        },
      }}
    >
      <AntApp>
        <BrowserRouter>
          <App />
        </BrowserRouter>
      </AntApp>
    </ConfigProvider>
  </React.StrictMode>,
)
