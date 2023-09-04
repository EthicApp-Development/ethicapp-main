import React from 'react';
import { Link } from 'react-router-dom';

function Reports() {
  return(
    <>
    <h2>Reports Page</h2>
    <h2>Show all reports Here</h2>
    <ul>
      <li><Link to="/report/start_activity">Started Activities Report</Link></li>
      <li><Link to="/report/create_account">Accounts Created Report</Link></li>
      <li><Link to="/report/logins">Logins Report</Link></li>
      <li><Link to="/report/top_professors">Top Professors Report</Link></li>
    </ul>
    </>
  ) 
}

export default Reports;
