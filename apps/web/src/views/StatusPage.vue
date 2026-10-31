<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { useRoute, useRouter } from "vue-router";
import { publicStatusApi, type PublicStatusPayload } from "../api/client";

/** 公开状态页（Week 4）：路由 /status/:slug（免登录），数据来自 GET /api/public/status/:slug。
 *  后端已做数据最小化：这里只渲染项目名/监控状态/30 天可用率/进行中事件的时长，不接触任何内部信息。
 *  从管理台的 /statuspage 进入时无 slug，展示一个 slug 输入框跳转到公开路由。 */
const route = useRoute();
const router = useRouter();
const slug = computed(() => (typeof route.params.slug === "string" ? route.params.slug : ""));
const payload = ref<PublicStatusPayload | null>(null);
const error = ref("");
const slugInput = ref("");

const banner = computed(() => {
  switch (payload.value?.overall) {
    case "major_outage": return { text: "重大故障：全部监控异常", cls: "major" };
    case "partial_outage": return { text: "部分故障：个别监控异常", cls: "partial" };
    default: return { text: "全部正常运行", cls: "ok" };
  }
});
const fmtTime = (s?: string) => (s ? new Date(s).toLocaleString() : "—");
const fmtDuration = (sec: number) => {
  if (sec < 3600) return `${Math.floor(sec / 60)} 分钟`;
  if (sec < 86400) return `${Math.floor(sec / 3600)} 小时 ${Math.floor((sec % 3600) / 60)} 分钟`;
  return `${Math.floor(sec / 86400)} 天 ${Math.floor((sec % 86400) / 3600)} 小时`;
};
async function load() {
  if (!slug.value) return;
  error.value = "";
  try { payload.value = await publicStatusApi.get(slug.value); }
  catch (e) { error.value = e instanceof Error ? e.message : String(e); payload.value = null; }
}
onMounted(load);
</script>
<template>
  <section class="view">
    <template v-if="!slug">
      <h2>状态页</h2>
      <p class="muted">输入项目 slug 查看公开状态页（免登录）：</p>
      <div class="bar">
        <input v-model="slugInput" placeholder="project-slug" @keyup.enter="router.push(`/status/${slugInput}`)" />
        <button :disabled="!slugInput" @click="router.push(`/status/${slugInput}`)">打开</button>
      </div>
    </template>
    <template v-else>
      <p v-if="error" class="err">状态页加载失败：{{ error }}</p>
      <template v-if="payload">
        <h2>{{ payload.projectName }}</h2>
        <div class="banner" :class="banner.cls">{{ banner.text }}</div>
        <table class="tbl">
          <thead><tr><th></th><th>监控</th><th>状态</th><th>30 天可用率</th><th>最近判定</th></tr></thead>
          <tbody>
            <tr v-for="m in payload.monitors" :key="m.name">
              <td><span class="dot" :class="m.status"></span></td>
              <td>{{ m.name }}</td><td>{{ m.status }}</td>
              <td>{{ m.uptime30dPct === null ? "—" : `${m.uptime30dPct.toFixed(2)}%` }}</td>
              <td>{{ fmtTime(m.lastVerdictAt) }}</td>
            </tr>
          </tbody>
        </table>
        <p v-if="!payload.monitors.length" class="muted">暂无监控。</p>
        <h3>进行中的事件</h3>
        <ul v-if="payload.activeIncidents.length" class="incidents">
          <li v-for="(i, idx) in payload.activeIncidents" :key="idx">
            {{ i.monitorName }} —— 始于 {{ fmtTime(i.startedAt) }}，已持续 {{ fmtDuration(i.durationSec) }}
          </li>
        </ul>
        <p v-else class="muted">无进行中的事件。</p>
        <p class="muted foot">更新时间 {{ fmtTime(payload.generatedAt) }} · 可用率为近 30 天口径</p>
      </template>
    </template>
  </section>
</template>
<style scoped>
.view{padding:24px;max-width:860px;margin:0 auto}.muted{color:#888}.err{color:#c0392b}
.bar{display:flex;gap:8px}.bar input{padding:6px 10px;min-width:240px}
.banner{border-radius:8px;padding:14px 18px;font-size:18px;font-weight:600;margin-bottom:16px}
.banner.ok{background:#eef6ee;color:#2e7d32}.banner.partial{background:#fdf3e0;color:#b26a00}
.banner.major{background:#fdecea;color:#c0392b}
.tbl{border-collapse:collapse;width:100%;margin-bottom:16px}
.tbl th,.tbl td{border-bottom:1px solid #eee;padding:6px 10px;text-align:left;font-size:13px}
.dot{display:inline-block;width:10px;height:10px;border-radius:50%;background:#2e7d32}
.dot.suspect{background:#e6a23c}.dot.down{background:#c0392b}.dot.maintenance{background:#8a97a5}
.incidents{padding-left:18px}.foot{font-size:12px}
</style>
