import "@testing-library/jest-dom/vitest"
import "fake-indexeddb/auto"
import { configure } from "@testing-library/react"

// findBy 默认只等 1000 ms。App.test.tsx 那条建项目的用例要过 fake-indexeddb
// 与 workflow 求值，pnpm check 并发跑多个包时 1000 ms 不够，出现过三次偶发失败，
// 单跑该包必过。放宽等待上限不改变断言本身：断的仍是同一份 DOM 状态，
// 只是允许在负载高的机器上多等一会。
// 2026-08-22 再次在全量检查下超时（单跑通过），演示包重建后并发负载更高，
// 由 5 秒放宽到 15 秒。这条用例本身在空闲机器上 230 ms 就跑完。
configure({ asyncUtilTimeout: 15_000 })
