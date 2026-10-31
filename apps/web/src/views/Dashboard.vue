<script setup lang="ts">
import { onMounted, ref } from "vue";
import { projectsApi, statsApi, type FlakyStats, type OverviewStats, type ProjectLite } from "../api/client";

/** 仪表盘（Week 2 接真实 API）：GET /stats/overview —— 今日执行/成功率（口径见后端：
 *  分母剔除 infra_failed 与未终态）/当前 down 数 + 各监控状态 + 最近失败（双轨徽章）。 */
const projects = ref<ProjectLite[]>([]);
const projectId = ref("");
const overview = ref<OverviewStats | null>(null);
const loading = ref(false);
const error = ref("");

const flaky = ref<FlakyStats | null>(null);
const flakyDays = ref(7);
const flakyError = ref("");
async function loadFlaky() {
  if (!projectId.value) { flaky.value = null; return; }
  flakyError.value = "";
  try { flaky.value = await statsApi.flaky(projectId.value, flakyDays.value); }
  catch (e) { flakyError.value = e instanceof Error ? e.message : String(e); flaky.value = null; }
}
async function loadOverview() {
  if (!projectId.value) { overview.value = null; return; }
  loading.value = true; error.value = "";
  try { overview.value = await statsApi.overview(projectId.value); await loadFlaky(); }
  catch (e) { error.value = e instanceof Error ? e.message : String(e); overview.value = null; }
  finally { loading.value = false; }
}
onMounted(async () => {
  try {
    projects.value = await projectsApi.list();
    if (projects.value.length) { projectId.value = projects.value[0].id; await loadOverview(); }
  } catch (e) { error.value = e instanceof Error ? e.message : String(e); }
});
const pct = (r: number | null) => (r === null ? "—" : `${(r * 100).toFixed(1)}%`);
const fmtTime = (s?: string) => (s ? new Date(s).toLocaleString() : "—");
</script>
<template>
  <section class="view">
    <h2>Dashboard</h2>
    <div class="bar">
      <label>项目
        <select v-model="projectId" @change="loadOverview">
          <option v-for="p in projects" :key="p.id" :value="p.id">{{ p.name }}（{{ p.slug }}）</option>
        </select>
      </label>
      <span v-if="loading" class="muted">加载中…</span>
      <span v-if="error" class="err">{{ error }}</span>
      <span v-if="!projects.length && !error" class="muted">暂无项目，先在 Projects 里创建。</span>
    </div>
    <template v-if="overview">
      <div class="cards">
        <div class="card"><div class="num">{{ overview.todayTotal }}</div><div class="lbl">今日执行</div></div>
        <div class="card"><div class="num">{{ pct(overview.successRate) }}</div><div class="lbl">今日成功率（剔除 infra_failed）</div></div>
        <div class="card"><div class="num" :class="{ bad: overview.downCount > 0 }">{{ overview.downCount }}</div><div class="lbl">当前 Down 监控</div></div>
        <div class="card"><div class="num">{{ overview.todayFinished }}</div><div class="lbl">今日已终态（成功率分母）</div></div>
      </div>
      <h3>监控状态</h3>
      <table v-if="overview.monitors.length" class="tbl">
        <thead><tr><th>用例</th><th>状态</th><th>连续失败</th><th>Flaky</th><th>Infra</th><th>最近迁移</th></tr></thead>
        <tbody>
          <tr v-for="m in overview.monitors" :key="m.planId">
            <td>{{ m.caseName }}</td>
            <td><span class="badge" :class="m.displayStatus">{{ m.displayStatus }}</span></td>
            <td>{{ m.consecutiveFailures }}</td><td>{{ m.flakyCount }}</td><td>{{ m.infraCount }}</td>
            <td>{{ fmtTime(m.lastTransitionAt) }}</td>
          </tr>
        </tbody>
      </table>
      <p v-else class="muted">该项目还没有计划（Plans）。</p>
      <h3>最近失败</h3>
      <table v-if="overview.recentFailures.length" class="tbl">
        <thead><tr><th>用例</th><th>轨道</th><th>状态</th><th>耗时</th><th>完成时间</th></tr></thead>
        <tbody>
          <tr v-for="f in overview.recentFailures" :key="f.executionId">
            <td>{{ f.caseName }}</td>
            <td><span class="badge track">{{ f.track === "code" ? "代码" : "DSL" }}</span></td>
            <td>{{ f.status }}</td><td>{{ f.durationMs ?? "—" }} ms</td><td>{{ fmtTime(f.finishedAt) }}</td>
          </tr>
        </tbody>
      </table>
      <p v-else class="muted">暂无失败记录。</p>
      <h3>Flaky 榜
        <label class="muted" style="font-size:13px;font-weight:400">窗口
          <select v-model.number="flakyDays" @change="loadFlaky">
            <option :value="7">7 天</option><option :value="14">14 天</option><option :value="30">30 天</option>
          </select>
        </label>
      </h3>
      <p v-if="flakyError" class="err">{{ flakyError }}</p>
      <table v-if="flaky && flaky.items.length" class="tbl">
        <thead><tr><th>用例</th><th>终态执行</th><th>Flaky 数</th><th>Flaky 率</th><th>最长连串</th><th>最近 Flaky</th><th>隔离建议</th></tr></thead>
        <tbody>
          <tr v-for="f in flaky.items" :key="`${f.caseId}|${f.planId ?? ''}`">
            <td>{{ f.caseName }}</td><td>{{ f.totalTerminal }}</td><td>{{ f.flaky }}</td>
            <td>{{ (f.flakyRate * 100).toFixed(1) }}%</td><td>{{ f.maxConsecutiveFlaky }}</td>
            <td>{{ fmtTime(f.lastFlakyAt) }}</td>
            <td><span v-if="f.quarantineSuggested" class="badge down" :title="f.quarantineReason">建议隔离</span><span v-else class="muted">—</span></td>
          </tr>
        </tbody>
      </table>
      <p v-else-if="flaky" class="muted">窗口内暂无终态执行。</p>
      <p class="muted" style="font-size:12px">口径：flaky 率 = flaky / 终态执行（passed+flaky+failed+timeout，剔除 infra_failed）；建议隔离 = 率 &gt; 20% 或连续 flaky ≥ 5 次（仅建议，自动隔离是 V1）。</p>
    </template>
  </section>
</template>
<style scoped>
.view{padding:24px}.muted{color:#888}.err{color:#c0392b}
.bar{display:flex;gap:12px;align-items:center;margin-bottom:16px}
.cards{display:flex;gap:12px;flex-wrap:wrap;margin-bottom:8px}
.card{border:1px solid #e3e3e3;border-radius:8px;padding:14px 18px;min-width:150px}
.num{font-size:26px;font-weight:600}.num.bad{color:#c0392b}.lbl{color:#888;font-size:12px;margin-top:4px}
.tbl{border-collapse:collapse;width:100%;margin-bottom:16px}
.tbl th,.tbl td{border-bottom:1px solid #eee;padding:6px 10px;text-align:left;font-size:13px}
.badge{padding:1px 8px;border-radius:10px;font-size:12px;background:#eef6ee;color:#2e7d32}
.badge.suspect{background:#fdf3e0;color:#b26a00}.badge.down{background:#fdecea;color:#c0392b}
.badge.maintenance{background:#eceff3;color:#5b6b7c}
.badge.track{background:#eaf0fd;color:#2456a6}
</style>
