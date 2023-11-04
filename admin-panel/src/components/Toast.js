import React from 'react';
import Snackbar from '@mui/material/Snackbar';
import MuiAlert from '@mui/material/Alert';

const Alert = React.forwardRef(function Alert(props, ref) {
  return <MuiAlert elevation={6} ref={ref} variant="filled" {...props} />;
});

let severityToast;

const Toast = ({ open, message, onClose, severity }) => {
  if (severity===0) {
    severityToast="error"
  } else {
    severityToast="success"
  }
  return (
    <Snackbar
      open={open}
      autoHideDuration={1500}
      onClose={onClose}
      anchorOrigin={{ vertical: 'top', horizontal: 'center' }}
    >
      <Alert onClose={onClose} severity={severityToast}>
        {message}
      </Alert>
    </Snackbar>
  );
};

export default Toast;
