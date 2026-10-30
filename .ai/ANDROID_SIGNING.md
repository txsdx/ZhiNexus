# 固定 Android 发布签名

此前每次无Secret的构建都会临时生成新密钥，因此两个APK可能无法覆盖安装。当前已移除临时生成/开发签名回退，配置缺失时在SDK准备前失败，不再悄悄更换应用身份。

专用RSA4096/PKCS12密钥已生成于当前私有工作区，不在源码、Release或日志中。公开证书在src-tauri/mobile/android/release-certificate.der，SHA-256在同目录release-certificate.sha256；CI签名前和签名后均核对该指纹，拒绝意外轮换。私钥和密码必须长期独立备份，不能重新生成来修复配置错误。

仓库需要四个Actions Secrets：ANDROID_KEYSTORE_BASE64、ANDROID_KEY_ALIAS、ANDROID_KEYSTORE_PASSWORD、ANDROID_KEY_PASSWORD。维护者在已登录gh且具有Secrets写权限的终端执行：

```bash
node scripts/setup-android-signing.mjs /private/path/signing-secrets.json txsdx/ZhiNexus
```

脚本读取私有备份，通过stdin写入，参数/输出不含秘密。当前连接对仓库secrets列表和写入所需的public-key均返回HTTP403，不能通过该连接配置；这与仓库公开读取或发布Release权限不同。维护者已确认四个Secrets配置完成；无需让当前连接获得读取Secret原值的能力。标准Build预检和实际0.23 APK均已验证身份并使用同一密钥签名，不将密钥放入缓存、构建产物或公开仓库。

不能从已签名APK恢复私钥。此前临时密钥只存在于已结束runner的临时目录，现有产物/缓存没有发布该密钥；新证书无法授权覆盖不同旧证书。Android安装器前会检查包名与证书，明确提示先备份并保留草稿，再完成一次旧开发包到固定签名包的切换。不得自动卸载、清数据或声称新密钥能绕过系统签名保护。固定证书后的未来覆盖升级仍需实际安装验证。


## 配置与核验

1. 在私有备份中打开configure-secrets.html，只在本机查看/复制四项值，填入[仓库Actions Secrets](https://github.com/txsdx/ZhiNexus/settings/secrets/actions)。不要把私有备份上传到公开Issue、源码或Release。
2. 这份PKCS12使用同一store/key密码；两项都必须填对。Build预检还会实际访问私钥，不能仅凭成功导出公开证书推定能签名。
3. 固定SHA-256：`3ca565872acafd9121a3fde847d6da82df43d3f3ba96f453220218c538e55d5f`。公开证书有效期2026-10-29至2054-03-16。不要重新生成密钥来纠正Secret配置；从同一备份恢复。
4. 配置就绪后按标准Build门禁编译验证。APK名称为`ZhiNexus_android_arm64_<version>.apk`，不再带development后缀。签名/包/摘要验证与系统安装授权仍保留。

平台依据：[Android官方签名说明](https://developer.android.com/studio/publish/app-signing)。官方明确更新需匹配证书，未使用Play托管时丢失签名私钥会失去原应用身份的更新能力；新密钥不能补回旧身份。


## 0.23最终验证

最终[Build41017924868](https://github.com/txsdx/ZhiNexus/actions/runs/41017924868)全部成功：237单元/47脚本/109浏览器与生产构建，Windows11项、Ubuntu12项原生边界，Windows完整真实实包和Android arm64/Kotlin编译、固定签名验证。三平台四资产已下载读回，版本/URL/SHA-256、Windows单文件、Android图标/包名/递增versionCode及证书、匿名latest.json和发布标签均已独立验证。详细证据见[ITERATION_023](ITERATION_023.md)。

签名后的校验不再解析Signer #1等显示标签：先由apksigner verify --print-certs-pem验证签名，再用Node crypto.X509Certificate解析唯一证书的DER并计算SHA-256。实际发布APK分别经SDK35/37复验同一指纹；缺失、重复、损坏、错误指纹回归均通过。当前执行工作区已恢复，维护者配置的四个Secrets已生效，不再重复请求配置或回读秘密原值。

## 0.24延续验证

Build41102913797与实际0.24 APK通过；与0.23证书相同，SDK35/37标准PEM/DER核验，包名不变、versionCode递增。Release下载文件与已独立验证CI包字节完全相同。没有生成新密钥，未做实体安装验证。
