<script setup lang="ts">
import { onMounted, ref } from "vue";
import { executionsApi, projectsApi, type EnrichedExecution, type ProjectLite } from "../api/client";

/** 执行列表（Week 2）：双轨统一列表 GET /executions?projectId=，每行带轨道徽章（DSL/代码）。 */
const projects = ref<ProjectLite[]>([]);
const projectId = ref("");
const rows = ref<EnrichedExecution[]>([]);
const loading = ref(false);
const error = ref("");

async function load() {
  if (!projectId.value) { rows.value = []; return; }
  loading.value = true; error.value = "";
  try { rows.value = await executionsApi.list(projectId.value); }
  catch (e) { error.value = e instanceof Error ? e.message : String(e); rows.value = []; }
  finally { loading.value = false; }
}
onMounted(async () => {
  try {
    projects.value = await projectsApi.list();
    if (projects.value.length) { projectId.value = projects.value[0].id; await load(); }
  } catch (e) { error.value = e instanceof Error ? e.message : String(e); }
});
const fmtTime = (s?: string) => (s ? new Date(s).toLocaleString() : "—");
</script>
<template>
  <section class="view">
    <h2>Executions</h2>
    <div class="bar">
      <label>项目
        <select v-model="projectId" @change="load">
          <option v-for="p in projects" :key="p.id" :value="p.id">{{ p.name }}（{{ p.slug }}）</option>
        </select>
      </label>
      <span v-if="loading" class="muted">加载中…</span>
      <span v-if="error" class="err">{{ error }}</span>
    </div>
    <table v-if="rows.length" class="tbl">
      <thead><tr><th>用例</th><th>轨道</th><th>状态</th><th>触发</th><th>地域</th><th>耗时</th><th>创建时间</th></tr></thead>
      <tbody>
        <tr v-for="r in rows" :key="r.execution.id">
          <td>{{ r.caseName }}</td>
          <td><span class="badge" :class="r.track">{{ r.track === "code" ? "代码" : "DSL" }}</span></td>
          <td><span class="badge" :class="r.execution.status">{{ r.execution.status }}</span></td>
          <td>{{ r.execution.triggerType }}</td>
          <td>{{ r.execution.region ?? "—" }}</td>
          <td>{{ r.execution.durationMs ?? "—" }} ms</td>
          <td>{{ fmtTime(r.execution.createdAt) }}</td>
        </tr>
      </tbody>
    </table>
    <p v-else-if="!loading && !error" class="muted">暂无执行记录。</p>
  </section>
</template>
<style scoped>
.view{padding:24px}.muted{color:#888}.err{color:#c0392b}
.bar{display:flex;gap:12px;align-items:center;margin-bottom:16px}
.tbl{border-collapse:collapse;width:100%}
.tbl th,.tbl td{border-bottom:1px solid #eee;padding:6px 10px;text-align:left;font-size:13px}
.badge{padding:1px 8px;border-radius:10px;font-size:12px;background:#eef6ee;color:#2e7d32}
.badge.code{background:#eaf0fd;color:#2456a6}.badge.dsl{background:#f3eafd;color:#6a3ec9}
.badge.failed{background:#fdecea;color:#c0392b}.badge.flaky{background:#fdf3e0;color:#b26a00}
.badge.infra_failed{background:#eee;color:#555}.badge.queued,.badge.running{background:#eef;color:#335}
</style>
