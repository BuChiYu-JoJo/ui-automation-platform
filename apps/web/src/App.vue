<script setup lang="ts">
import { computed } from "vue";
import { useRoute } from "vue-router";
const links = ["Dashboard","Projects","Cases","Plans","Executions","Incidents","StatusPage","Settings"];
const route = useRoute();
/** 公开状态页（/status/:slug）不套管理台布局：它面向外部访客，不应出现管理导航。 */
const isPublic = computed(() => route.meta.public === true);
</script>
<template>
  <RouterView v-if="isPublic" />
  <div v-else class="layout">
    <aside class="side"><h1>UIP 平台</h1>
      <RouterLink v-for="l in links" :key="l" :to="`/${l.toLowerCase()}`" class="link">{{ l }}</RouterLink>
    </aside>
    <main class="main"><RouterView /></main>
  </div>
</template>
<style scoped>
.layout{display:flex;min-height:100vh}.side{width:200px;border-right:1px solid #ddd;padding:16px;display:flex;flex-direction:column;gap:8px}
.link{text-decoration:none;color:inherit}.main{flex:1}
</style>
