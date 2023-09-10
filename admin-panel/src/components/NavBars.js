import React from "react"

import {Link, useLocation } from "react-router-dom"


export default function NavBar(){
    const location = useLocation();
    const urlBlackList = ["/admin/login"]

    if ( urlBlackList.includes(location.pathname)) {
        return null;
    }

    return <nav>
        <ul>
            <li><Link to="/admin">Home</Link></li>
            <li><Link to="/admin/institution">Institution</Link></li>
            <li><Link to="/admin/reports">Reports</Link></li>
            <li><Link to="/admin/users">Users</Link></li>
        </ul>
    </nav>
}