// App Shell + MultiRoute.
// Every section URL renders AppShell, which swaps the content area via a MultiRoute.
// Dynamic params use ${name} (NOT :name). Keep the 404 route last.
const routes = [
   { path: '/', component: 'AppShell', metadata: { title: 'VKRAFTS · Hub' } },
   { path: '/designer', component: 'AppShell', metadata: { title: 'VKRAFTS · Designer' } },
   { path: '/canvas', component: 'AppShell', metadata: { title: 'VKRAFTS · Canvas' } },
   { path: '/layouts', component: 'AppShell', metadata: { title: 'VKRAFTS · Plantillas de Hoja' } },
   { path: '/font/${id}', component: 'AppShell', metadata: { title: 'VKRAFTS · Fuente' } },
   { path: '/about', component: 'AppShell', metadata: { title: 'VKRAFTS · Acerca de' } },
   { path: '/404', component: 'NotFound', metadata: { title: 'VKRAFTS · Página no encontrada' } }
];

export default routes;
