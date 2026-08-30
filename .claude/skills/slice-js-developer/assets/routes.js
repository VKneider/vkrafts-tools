/**
 * SLICE_TEMPLATE: routes.js
 *
 * Notes:
 *   - Dynamic params use ${name} (NOT :name).
 *   - metadata is free-form; guards and components can read it.
 *   - The 404 route is conventional — keep it last.
 *   - For App Shell + MultiRoute pattern, every URL points to AppShell;
 *     for Single-View SPA, only "/" exists.
 */

const routes = [
  // ── App Shell + MultiRoute example ─────────────────────────────────
  // Every section URL renders AppShell, which contains a MultiRoute.
  { path: '/',          component: 'AppShell', metadata: { title: 'Home' } },
  { path: '/projects',  component: 'AppShell', metadata: { title: 'Projects' } },

  // Dynamic param — ${id} is parsed and exposed in slice.router.activeRoute.params.id
  { path: '/projects/${id}', component: 'AppShell', metadata: { title: 'Project Detail' } },

  // Nested params
  { path: '/users/${userId}/posts/${postId}', component: 'AppShell' },

  // Private route (read by beforeEach guard)
  {
    path: '/admin',
    component: 'AppShell',
    metadata: { private: true, role: 'admin', title: 'Admin' }
  },

  { path: '/login',     component: 'LoginPage', metadata: { title: 'Sign in' } },

  // 404 — keep last
  { path: '/404',       component: 'NotFound', metadata: { title: 'Not Found' } }
];

export default routes;

// ──────────────────────────────────────────────────────────────────
// Guards — typically registered in App/index.js, not here, but
// shown for reference:
// ──────────────────────────────────────────────────────────────────
//
// slice.router.beforeEach(async (to, from, next) => {
//   if (to.metadata?.private) {
//     const auth = slice.context.getState('auth');
//     if (!auth?.isLoggedIn) return next({ path: '/login' });
//   }
//   next();
// });
//
// slice.router.afterEach((to) => {
//   document.title = to.metadata?.title ?? 'My App';
// });
//
// await slice.router.start();
