# Nuxt Monitor

Apple Silicon Mac 本机监控：Nuxt 4 + Nuxt UI + Swift，数据链路为 Swift → Nitro → SSE → UChart。系统要求和使用说明见 README。

## 命令

- 使用 Vite+：开始工作前运行 `vp install`；项目脚本用 `vp run <name>`，不要混用同名内置命令。
- 开发 `vp run dev`；构建 `vp run build`；生产启动 `vp run start`。修改 Swift 后重启开发服务以重新编译。
- 代码变更运行 `vp check`、`vp test`、`vp run typecheck`、`vp run build`；原生变更另跑 `vp run test:native` 并实测传感器。
- TS/JS 脚本用 `vpx <file>`，不添加 tsx/ts-node。工具链异常先运行 `vp env doctor`；文档在 `node_modules/vite-plus/docs`。

## 实现约束

- Vue 使用 Composition API、`<script setup lang="ts">`；样式用 Tailwind，图表用现有 `UChart` area 图，不新增图表库。
- 服务绑定 `127.0.0.1`，使用 Node/Nitro，不预渲染首页。生产构建携带采集二进制，运行时不编译。
- 每 500 ms 采样，内存保留 15 分钟、最多 1800 点；超过 3 秒无更新标记过期。常量集中在 `shared/utils/monitor.ts`，变更时同步原生默认值、测试和文档。
- Nitro 管理单个共享采集进程；保留退出清理、异常退避重启及 SSE 重连快照同步。
- 采集只读，不要求 sudo 或安装 macmon。CPU 使用 `host_processor_info` 差值，温度使用 M3 AppleSMC 映射，内存排除文件缓存；单项失败不影响其他指标。
- 滚动与采样解耦，复用未变化的曲线数据；暂停、隐藏页面时停止动画，尊重减少动画偏好。不要修改真实读数来制造平滑效果。
- 原始缺测值保留 `null`，图表在缺测和休眠区间断线。不要用模拟数据或热压力替代温度。
- 不修改生成产物作为实现。启动前检查端口，仅清理由本任务启动或用户指定停止的进程。

## 界面约定

- 仅温度（CPU/GPU，°C）、CPU、GPU、内存（已用／总量，GiB）四块图表；两列布局，窄屏单列。使用真实时间轴，CPU/GPU 固定 0–100%。
- 顶部仅 `1 / 5 / 15 分钟` 和暂停／继续，默认 1 分钟。暂停冻结画面、后台继续采样，继续后回到最新数据。
- 读数使用等宽字体、`tabular-nums` 和固定宽度。缺测时各项独立沿用上次有效值；首次无值留空，不显示 `—`。
- 跟随系统明暗主题；不添加重复概览、侧栏、介绍、装饰图标或设置页。仅异常时显示简短提示且不挤动布局，说明文档放 README。
- 界面变更检查窄屏、明暗主题、悬停／键盘／触摸、暂停恢复、缺测与重连，以及滚动开销。

流验证：`MONITOR_URL=http://127.0.0.1:<端口> vpx scripts/verify-stream.ts [秒数]`，默认 910 秒。
