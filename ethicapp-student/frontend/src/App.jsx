import { RouterProvider } from 'react-router-dom';
import router from './router';
import { StudentUserProvider } from './context/StudentUserContext.jsx';

export default function App() {
  return (
    <StudentUserProvider>
      <RouterProvider router={router} />
    </StudentUserProvider>
  );
}
