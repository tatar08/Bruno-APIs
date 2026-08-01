import { Provider } from 'react-redux';
import { AppProvider } from 'providers/App';
import { ToastProvider } from 'providers/Toaster';
import { HotkeysProvider } from 'providers/Hotkeys';
import { PromptVariablesProvider } from 'providers/PromptVariables';

import ReduxStore from 'providers/ReduxStore';
import ThemeProvider from 'providers/Theme/index';
import ErrorBoundary from './ErrorBoundary';

import '../styles/globals.css';
import 'codemirror/lib/codemirror.css';
import 'graphiql/graphiql.min.css';
import 'react-tooltip/dist/react-tooltip.css';
import '@usebruno/graphql-docs/dist/esm/index.css';
import '@fontsource/inter/100.css';
import '@fontsource/inter/200.css';
import '@fontsource/inter/300.css';
import '@fontsource/inter/400.css';
import '@fontsource/inter/500.css';
import '@fontsource/inter/600.css';
import '@fontsource/inter/700.css';
import '@fontsource/inter/800.css';
import '@fontsource/inter/900.css';
import { setupPolyfills } from 'utils/common/setupPolyfills';
import { getTransport } from 'utils/common/ipc-transport';
setupPolyfills();

function Main({ children }) {
  // Initialise the compatible IPC API before any child component mounts.
  // Electron uses preload.js; a browser uses the bridge server.
  getTransport();

  return (
    <ErrorBoundary>
      <Provider store={ReduxStore}>
        <ThemeProvider>
          <ToastProvider>
            <PromptVariablesProvider>
              <AppProvider>
                <HotkeysProvider>
                  {children}
                </HotkeysProvider>
              </AppProvider>
            </PromptVariablesProvider>
          </ToastProvider>
        </ThemeProvider>
      </Provider>
    </ErrorBoundary>
  );
}

export default Main;
