import { createBrowserRouter, Navigate } from 'react-router-dom';
import ManagementLayout from '../components/layout/ManagementLayout.jsx';
import InstitutionPage from '../pages/InstitutionPage.jsx';
import ProfilePage from '../pages/ProfilePage.jsx';
import UsersPage from '../pages/UsersPage.jsx';
import UserShowPage from '../pages/UserShowPage.jsx';

const router = createBrowserRouter([
  {
    path: '/',
    element: <Navigate to="/users" replace />
  },
  {
    path: '/users',
    element: (
      <ManagementLayout>
        <UsersPage />
      </ManagementLayout>
    )
  },
  {
    path: '/users/:id',
    element: (
      <ManagementLayout>
        <UserShowPage />
      </ManagementLayout>
    )
  },
  {
    path: '/institution',
    element: (
      <ManagementLayout>
        <InstitutionPage />
      </ManagementLayout>
    )
  },
  {
    path: '/profile',
    element: (
      <ManagementLayout>
        <ProfilePage />
      </ManagementLayout>
    )
  },
  {
    path: '*',
    element: <Navigate to="/users" replace />
  }
], {
  basename: '/mng'
});

export default router;
