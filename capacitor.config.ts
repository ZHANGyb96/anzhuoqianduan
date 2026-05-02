import { CapacitorConfig } from '@capacitor/cli'
const config: CapacitorConfig = {
    appId:   'com.yourname.alphascan',
    appName: 'AlphaScan AI',
    webDir:  'out',
    android: {
        allowMixedContent: true  // 允许混合HTTP请求
    },
    plugins: {
        CapacitorHttp: { enabled: true }
    }
}
export default config