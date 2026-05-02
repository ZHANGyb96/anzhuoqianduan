/** @type {import('next').NextConfig} */
module.exports = {
  output: 'export',
  images: {
    unoptimized: true
  },
  // 强制转译这些使用了新语法的第三方库，兼容旧版 WebView
  transpilePackages: ['jose'],
};