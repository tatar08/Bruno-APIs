import React, { useRef, useEffect, useCallback } from 'react';
import get from 'lodash/get';
import debounce from 'lodash/debounce';
import { useFormik } from 'formik';
import { useSelector, useDispatch } from 'react-redux';
import { savePreferences } from 'providers/ReduxStore/slices/app';
import { browseDirectory } from 'providers/ReduxStore/slices/collections/actions';
import { updateWorkspaceIconAction } from 'providers/ReduxStore/slices/workspaces/actions';
import StyledWrapper from './StyledWrapper';
import * as Yup from 'yup';
import toast from 'react-hot-toast';
import path from 'utils/common/path';
import { IconTrash, IconPhoto } from '@tabler/icons';

// Keeps the base64 data URI under the 512KB backend limit (workspace-config.js: MAX_WORKSPACE_ICON_BYTES)
const MAX_WORKSPACE_ICON_FILE_BYTES = 384 * 1024;

const readImageFileAsDataUri = (file) => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error || new Error('Failed to read image file'));
    reader.readAsDataURL(file);
  });
};

const General = () => {
  const preferences = useSelector((state) => state.app.preferences);
  const { workspaces, activeWorkspaceUid } = useSelector((state) => state.workspaces);
  const activeWorkspace = workspaces.find((w) => w.uid === activeWorkspaceUid);
  const dispatch = useDispatch();
  const inputFileCaCertificateRef = useRef();
  const workspaceIconInputRef = useRef();

  const preferencesSchema = Yup.object().shape({
    sslVerification: Yup.boolean(),
    customCaCertificate: Yup.object({
      enabled: Yup.boolean(),
      filePath: Yup.string().nullable()
    }),
    keepDefaultCaCertificates: Yup.object({
      enabled: Yup.boolean()
    }),
    storeCookies: Yup.boolean(),
    sendCookies: Yup.boolean(),
    timeout: Yup.mixed()
      .transform((value, originalValue) => {
        return originalValue === '' ? undefined : value;
      })
      .nullable()
      .test('isNumber', 'Request Timeout must be a number', (value) => {
        return value === undefined || !isNaN(value);
      })
      .test('isValidTimeout', 'Request Timeout must be equal or greater than 0', (value) => {
        return value === undefined || Number(value) >= 0;
      }),
    autoSave: Yup.object({
      enabled: Yup.boolean(),
      interval: Yup.mixed()
        .transform((value, originalValue) => {
          return originalValue === '' ? undefined : value;
        })
        .test('isNumber', 'Save Delay must be a number', (value) => {
          return value === undefined || !isNaN(value);
        })
        .test('isValidInterval', 'Save Delay must be at least 500ms', (value) => {
          return value === undefined || Number(value) >= 500;
        })
    }).test('intervalRequired', 'Save Delay is required when Auto Save is enabled', (value) => {
      // If autosave is enabled, interval must be provided
      if (value.enabled && (value.interval === undefined || value.interval === '')) {
        return false;
      }
      return true;
    }),
    runnerDelay: Yup.mixed()
      .transform((value, originalValue) => {
        return originalValue === '' ? undefined : value;
      })
      .nullable()
      .test('isNumber', 'Default Run Delay must be a number', (value) => {
        return value === undefined || !isNaN(value);
      })
      .test('isValidRunnerDelay', 'Default Run Delay must be equal or greater than 0', (value) => {
        return value === undefined || Number(value) >= 0;
      }),
    oauth2: Yup.object({
      useSystemBrowser: Yup.boolean()
    }),
    defaultLocation: Yup.string().max(1024)
  });

  const formik = useFormik({
    initialValues: {
      sslVerification: preferences.request.sslVerification,
      customCaCertificate: {
        enabled: get(preferences, 'request.customCaCertificate.enabled', false),
        filePath: get(preferences, 'request.customCaCertificate.filePath', null)
      },
      keepDefaultCaCertificates: {
        enabled: get(preferences, 'request.keepDefaultCaCertificates.enabled', true)
      },
      timeout: preferences.request.timeout,
      storeCookies: get(preferences, 'request.storeCookies', true),
      sendCookies: get(preferences, 'request.sendCookies', true),
      autoSave: {
        enabled: get(preferences, 'autoSave.enabled', false),
        interval: get(preferences, 'autoSave.interval', 1000)
      },
      runnerDelay: get(preferences, 'runner.delay', 0),
      oauth2: {
        useSystemBrowser: get(preferences, 'request.oauth2.useSystemBrowser', false)
      },
      defaultLocation: get(preferences, 'general.defaultLocation', '')
    },
    validationSchema: preferencesSchema,
    onSubmit: async (values) => {
      try {
        const newPreferences = await preferencesSchema.validate(values, { abortEarly: true });
        handleSave(newPreferences);
      } catch (error) {
        console.error('Preferences validation error:', error.message);
      }
    }
  });

  const handleSave = useCallback((newPreferences) => {
    dispatch(
      savePreferences({
        ...preferences,
        request: {
          sslVerification: newPreferences.sslVerification,
          customCaCertificate: {
            enabled: newPreferences.customCaCertificate.enabled,
            filePath: newPreferences.customCaCertificate.filePath
          },
          keepDefaultCaCertificates: {
            enabled: newPreferences.keepDefaultCaCertificates.enabled
          },
          timeout: newPreferences.timeout,
          storeCookies: newPreferences.storeCookies,
          sendCookies: newPreferences.sendCookies,
          oauth2: {
            useSystemBrowser: newPreferences.oauth2.useSystemBrowser
          }
        },
        autoSave: {
          enabled: newPreferences.autoSave.enabled,
          interval: newPreferences.autoSave.interval
        },
        runner: {
          delay: newPreferences.runnerDelay
        },
        general: {
          defaultLocation: newPreferences.defaultLocation
        }
      }))
      .catch((err) => console.log(err) && toast.error('Failed to update preferences'));
  }, [dispatch, preferences]);

  const handleSaveRef = useRef(handleSave);
  handleSaveRef.current = handleSave;

  const debouncedSave = useCallback(
    debounce((values) => {
      preferencesSchema.validate(values, { abortEarly: true })
        .then((validatedValues) => {
          handleSaveRef.current(validatedValues);
        })
        .catch((error) => {
        });
    }, 500),
    []
  );

  useEffect(() => {
    if (formik.dirty && formik.isValid) {
      debouncedSave(formik.values);
    }
    return () => {
      debouncedSave.flush();
    };
  }, [formik.values, formik.dirty, formik.isValid, debouncedSave]);

  const addCaCertificate = (e) => {
    const filePath = window?.ipcRenderer?.getFilePath(e?.target?.files?.[0]);
    if (filePath) {
      formik.setFieldValue('customCaCertificate.filePath', filePath);
    }
  };

  const deleteCaCertificate = () => {
    formik.setFieldValue('customCaCertificate.filePath', null);
  };

  const browseDefaultLocation = () => {
    dispatch(browseDirectory())
      .then((dirPath) => {
        if (typeof dirPath === 'string') {
          formik.setFieldValue('defaultLocation', dirPath);
        }
      })
      .catch((error) => {
        formik.setFieldValue('defaultLocation', '');
        console.error(error);
      });
  };

  const handleUploadWorkspaceIcon = () => {
    workspaceIconInputRef.current?.click();
  };

  const handleWorkspaceIconFileChange = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file || !activeWorkspaceUid) return;

    if (!file.type.startsWith('image/')) {
      toast.error('Please select an image file');
      return;
    }
    if (file.size > MAX_WORKSPACE_ICON_FILE_BYTES) {
      toast.error('Workspace icon image must be smaller than 384 KB');
      return;
    }

    try {
      const dataUri = await readImageFileAsDataUri(file);
      await dispatch(updateWorkspaceIconAction(activeWorkspaceUid, dataUri));
      toast.success('Workspace icon updated');
    } catch (error) {
      toast.error(error?.message || 'Failed to update workspace icon');
    }
  };

  const handleRemoveWorkspaceIcon = async () => {
    if (!activeWorkspaceUid) return;
    try {
      await dispatch(updateWorkspaceIconAction(activeWorkspaceUid, ''));
    } catch (error) {
      toast.error(error?.message || 'Failed to remove workspace icon');
    }
  };

  return (
    <StyledWrapper className="w-full">
      <div className="section-header">General Settings</div>
      <form className="bruno-form" onSubmit={formik.handleSubmit}>
        <div className="flex items-center mb-2">
          <input
            id="sslVerification"
            type="checkbox"
            name="sslVerification"
            checked={formik.values.sslVerification}
            onChange={formik.handleChange}
            className="mousetrap mr-0"
          />
          <label className="block ml-2 select-none" htmlFor="sslVerification">
            SSL/TLS Certificate Verification
          </label>
        </div>
        <div className="flex items-center mt-2">
          <input
            id="customCaCertificateEnabled"
            type="checkbox"
            name="customCaCertificate.enabled"
            checked={formik.values.customCaCertificate.enabled}
            onChange={formik.handleChange}
            className="mousetrap mr-0"
          />
          <label className="block ml-2 select-none" htmlFor="customCaCertificateEnabled">
            Use Custom CA Certificate
          </label>
        </div>
        {formik.values.customCaCertificate.filePath ? (
          <div
            className={`flex items-center mt-2 pl-6 ${formik.values.customCaCertificate.enabled ? '' : 'opacity-25'}`}
          >
            <span className="flex items-center border px-2 rounded-md">
              {path.basename(formik.values.customCaCertificate.filePath)}
              <button
                type="button"
                tabIndex="-1"
                className="pl-1"
                disabled={formik.values.customCaCertificate.enabled ? false : true}
                onClick={deleteCaCertificate}
              >
                <IconTrash strokeWidth={1.5} size={14} />
              </button>
            </span>
          </div>
        ) : (
          <div
            className={`flex items-center mt-2 pl-6 ${formik.values.customCaCertificate.enabled ? '' : 'opacity-25'}`}
          >
            <button
              type="button"
              tabIndex="-1"
              className="flex items-center border px-2 rounded-md"
              disabled={formik.values.customCaCertificate.enabled ? false : true}
              onClick={() => inputFileCaCertificateRef.current.click()}
            >
              Select File
              <input
                id="caCertFilePath"
                type="file"
                name="customCaCertificate.filePath"
                className="hidden"
                ref={inputFileCaCertificateRef}
                disabled={formik.values.customCaCertificate.enabled ? false : true}
                onChange={addCaCertificate}
              />
            </button>
          </div>
        )}
        <div className="flex items-center mt-2">
          <input
            id="keepDefaultCaCertificatesEnabled"
            type="checkbox"
            name="keepDefaultCaCertificates.enabled"
            checked={formik.values.keepDefaultCaCertificates.enabled}
            onChange={formik.handleChange}
            className={`mousetrap mr-0 ${formik.values.customCaCertificate.enabled && formik.values.customCaCertificate.filePath ? '' : 'opacity-25'}`}
            disabled={formik.values.customCaCertificate.enabled && formik.values.customCaCertificate.filePath ? false : true}
          />
          <label
            className={`block ml-2 select-none ${formik.values.customCaCertificate.enabled && formik.values.customCaCertificate.filePath ? '' : 'opacity-25'}`}
            htmlFor="keepDefaultCaCertificatesEnabled"
          >
            Keep Default CA Certificates
          </label>
        </div>
        <div className="flex items-center mt-2">
          <input
            id="storeCookies"
            type="checkbox"
            name="storeCookies"
            checked={formik.values.storeCookies}
            onChange={formik.handleChange}
            className="mousetrap mr-0"
          />
          <label className="block ml-2 select-none" htmlFor="storeCookies">
            Store Cookies automatically
          </label>
        </div>
        <div className="flex items-center mt-2">
          <input
            id="sendCookies"
            type="checkbox"
            name="sendCookies"
            checked={formik.values.sendCookies}
            onChange={formik.handleChange}
            className="mousetrap mr-0"
          />
          <label className="block ml-2 select-none" htmlFor="sendCookies">
            Send Cookies automatically
          </label>
        </div>
        <div className="flex items-center mt-2">
          <input
            id="oauth2.useSystemBrowser"
            type="checkbox"
            name="oauth2.useSystemBrowser"
            checked={formik.values.oauth2.useSystemBrowser}
            onChange={formik.handleChange}
            className="mousetrap mr-0"
          />
          <label className="block ml-2 select-none" htmlFor="oauth2.useSystemBrowser">
            Use System Browser for OAuth2 Authorization
          </label>
        </div>
        <div className="flex flex-col mt-6">
          <label className="block select-none" htmlFor="timeout">
            Request Timeout (in ms)
          </label>
          <input
            type="text"
            name="timeout"
            className="block textbox mt-2 w-16"
            autoComplete="off"
            autoCorrect="off"
            autoCapitalize="off"
            spellCheck="false"
            onChange={formik.handleChange}
            value={formik.values.timeout}
          />
        </div>
        {formik.touched.timeout && formik.errors.timeout ? (
          <div className="text-red-500">{formik.errors.timeout}</div>
        ) : null}
        <div className="flex items-center mt-6">
          <input
            id="autoSaveEnabled"
            type="checkbox"
            name="autoSave.enabled"
            checked={formik.values.autoSave.enabled}
            onChange={formik.handleChange}
            className="mousetrap mr-0"
          />
          <label className="block ml-2 select-none" htmlFor="autoSaveEnabled">
            Enable Auto Save
          </label>
        </div>
        <div className={`flex flex-col mt-2 ${!formik.values.autoSave.enabled ? 'opacity-50' : ''}`}>
          <label className="block select-none" htmlFor="autoSaveInterval">
            Save Delay (in ms)
          </label>
          <input
            type="text"
            name="autoSave.interval"
            id="autoSaveInterval"
            className="block textbox mt-2 w-24"
            autoComplete="off"
            autoCorrect="off"
            autoCapitalize="off"
            spellCheck="false"
            onChange={formik.handleChange}
            value={formik.values.autoSave.interval}
            disabled={!formik.values.autoSave.enabled}
          />
        </div>
        {formik.touched.autoSave && formik.errors.autoSave && typeof formik.errors.autoSave === 'string' && (
          <div className="text-red-500">{formik.errors.autoSave}</div>
        )}
        {formik.touched.autoSave?.interval && formik.errors.autoSave?.interval && (
          <div className="text-red-500">{formik.errors.autoSave.interval}</div>
        )}
        <div className="flex flex-col mt-6">
          <label className="block select-none" htmlFor="runnerDelay">
            Default Run Delay (in ms)
          </label>
          <p className="text-muted mt-1 text-xs">
            Default value for "Delay between requests" when opening the Collection Runner
          </p>
          <input
            type="text"
            name="runnerDelay"
            id="runnerDelay"
            className="block textbox mt-2 w-24"
            autoComplete="off"
            autoCorrect="off"
            autoCapitalize="off"
            spellCheck="false"
            onChange={formik.handleChange}
            value={formik.values.runnerDelay}
          />
        </div>
        {formik.touched.runnerDelay && formik.errors.runnerDelay ? (
          <div className="text-red-500">{formik.errors.runnerDelay}</div>
        ) : null}
        <div className="flex flex-col mt-6">
          <label className="block select-none default-location-label" htmlFor="defaultLocation">
            Default Location
          </label>
          <p className="text-muted mt-1 text-xs">
            Used as the default location for new workspaces and collections
          </p>
          <input
            type="text"
            name="defaultLocation"
            id="defaultLocation"
            className="block textbox mt-2 w-full cursor-pointer default-location-input"
            autoComplete="off"
            autoCorrect="off"
            autoCapitalize="off"
            spellCheck="false"
            readOnly={true}
            onChange={formik.handleChange}
            value={formik.values.defaultLocation || ''}
            onClick={browseDefaultLocation}
            placeholder="Click to browse for default location"
          />
          <div className="mt-1">
            <span
              className="text-link cursor-pointer hover:underline default-location-browse"
              onClick={browseDefaultLocation}
            >
              Browse
            </span>
          </div>
        </div>
        {formik.touched.defaultLocation && formik.errors.defaultLocation ? (
          <div className="text-red-500">{formik.errors.defaultLocation}</div>
        ) : null}

        <div className="flex flex-col mt-6">
          <label className="block select-none">Workspace Icon</label>
          <p className="text-muted mt-1 text-xs">
            Shown in the title bar for the current workspace ({activeWorkspace?.name || 'Untitled Workspace'})
          </p>
          <div className="flex items-center mt-2">
            {activeWorkspace?.icon ? (
              <img src={activeWorkspace.icon} alt="" className="workspace-icon-preview" />
            ) : (
              <div className="workspace-icon-preview-placeholder">
                <IconPhoto size={20} strokeWidth={1.5} />
              </div>
            )}
            <button
              type="button"
              tabIndex="-1"
              className="flex items-center border px-2 rounded-md ml-3"
              onClick={handleUploadWorkspaceIcon}
              disabled={!activeWorkspaceUid}
            >
              Upload Icon
              <input
                type="file"
                accept="image/*"
                className="hidden"
                ref={workspaceIconInputRef}
                onChange={handleWorkspaceIconFileChange}
              />
            </button>
            {activeWorkspace?.icon ? (
              <button
                type="button"
                tabIndex="-1"
                className="pl-2"
                onClick={handleRemoveWorkspaceIcon}
              >
                <IconTrash strokeWidth={1.5} size={14} />
              </button>
            ) : null}
          </div>
        </div>
      </form>
    </StyledWrapper>
  );
};

export default General;
