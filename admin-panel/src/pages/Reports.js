import React from 'react';
import { Link } from 'react-router-dom';

function Reports() {
  return(
    <>
    <h2>Reports Page</h2>
    <h2>Show all reports Here</h2>
    <ul>
      <li><Link to="/admin/report/start_activity">Get Report Chart 1</Link></li>
      <li><Link to="/admin/report/create_account">Get Report Chart 2</Link></li>
      <li><Link to="/admin/report/logins">Get Report Chart 3</Link></li>
      <li><Link to="/admin/report/top_professors">Get Report Chart 4</Link></li>
    </ul>
    </>
  ) 
}

export default Reports;
