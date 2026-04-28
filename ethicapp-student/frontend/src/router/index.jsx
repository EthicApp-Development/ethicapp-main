import { createBrowserRouter } from 'react-router-dom';
import StudentLayout from '../layouts/StudentLayout.jsx';
import HomePage from '../pages/HomePage.jsx';
import ActivityPage from '../pages/ActivityPage.jsx';
import NotFoundPage from '../pages/NotFoundPage.jsx';

const router = createBrowserRouter(
  [
    {
      path: '/',
      element: <StudentLayout />,
      children: [
        {
          index: true,
          element: <HomePage />
        },
        {
          path: 'sessions/:sessionId',
          element: <ActivityPage />
        },
        {
          path: '*',
          element: <NotFoundPage />
        }
      ]
    }
  ],
  {
    basename: '/student'
  }
);

export default router;
