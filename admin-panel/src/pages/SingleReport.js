import React from 'react';
import {useParams} from 'react-router-dom'

function SingleReport() {

  const {reportEnum} = useParams();

  return(
    <>
    <h2>Report Page for {reportEnum}</h2>
    <h2>Show the report basic info here and the query the data with the given parameters</h2>
    </>
  ) 
}

export default SingleReport;
