import { RouterProvider } from 'react-router-dom';
import { AppProviders } from './app/providers.jsx';
import router from './router/index.jsx';

function App() {
  return (
    <AppProviders>
      <RouterProvider router={router} />
    </AppProviders>
  );
}

export default App;
