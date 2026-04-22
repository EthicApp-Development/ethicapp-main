import { createBrowserRouter } from 'react-router-dom';
import StudentLayout from '../layouts/StudentLayout.jsx';
import HomePage from '../pages/HomePage.jsx';
import SessionDetailPage from '../pages/SessionDetailPage.jsx';
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
          element: <SessionDetailPage />
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
