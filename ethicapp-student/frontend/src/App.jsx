import { RouterProvider } from 'react-router-dom';
import router from './router';
import { StudentUserProvider } from './context/StudentUserContext.jsx';
import { StudentActivityStateProvider } from './context/StudentActivityStateContext.jsx';

export default function App() {
  return (
    <StudentUserProvider>
      <StudentActivityStateProvider>
        <RouterProvider router={router} />
      </StudentActivityStateProvider>
    </StudentUserProvider>
  );
}
