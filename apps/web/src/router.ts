import { createRouter, createWebHistory } from "vue-router";
export const router = createRouter({ history: createWebHistory(), routes: [
    { path: "/", redirect: "/dashboard" },
    { path: "/dashboard", name: "Dashboard", component: () => import("./views/Dashboard.vue") },
    { path: "/projects", name: "Projects", component: () => import("./views/Projects.vue") },
    { path: "/cases", name: "Cases", component: () => import("./views/Cases.vue") },
    { path: "/plans", name: "Plans", component: () => import("./views/Plans.vue") },
    { path: "/executions", name: "Executions", component: () => import("./views/Executions.vue") },
    { path: "/incidents", name: "Incidents", component: () => import("./views/Incidents.vue") },
    { path: "/statuspage", name: "StatusPage", component: () => import("./views/StatusPage.vue") },
    { path: "/status/:slug", name: "PublicStatus", component: () => import("./views/StatusPage.vue"), meta: { public: true } },
    { path: "/settings", name: "Settings", component: () => import("./views/Settings.vue") },
  ] });
