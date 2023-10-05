import { Line, Bar } from 'react-chartjs-2';
function ParseGraphData(apiData){

    let graphDataTemp={}

    switch (apiData["report_type"]) {
        case "start_activity":
             graphDataTemp = {
                labels: apiData["report_x_data"],
                datasets: [
                  {
                    label: 'Sample Line Chart',
                    data: apiData["report_y1_data"],
                    fill: false,
                    borderColor: 'rgba(75,192,192,1)',
                    borderWidth: 2,
                  },
                ],
              };
            break;
        
        case "create_account":
            graphDataTemp = {
                labels: RemoveDuplicates(apiData["report_x_data"]),
                datasets: [
                    {
                    label: 'Sample Line Chart',
                    data: apiData["report_y1_data"],
                    fill: false,
                    borderColor: 'rgba(75,192,192,1)',
                    borderWidth: 2,
                    },
                    {
                    label: 'Sample Line Chart',
                    data: apiData["report_y2_data"],
                    fill: false,
                    borderColor: 'rgba(75,0,192,1)',
                    borderWidth: 2,
                    },
                ],
                };
            break;
    }

    return graphDataTemp
};

function ParseGraphOptions(apiData){

    let options={}

    switch (apiData["report_type"]) {
        case "start_activity":
            options = {
                scales: {
                    y: {
                    beginAtZero: true,
                    },
                },
            };
            break;

        case "create_account":
            options = {
                scales: {
                  x: { stacked: true },
                  y: { stacked: true },
                },
            };
            break;    
    }


    return options
};

export function CreateGraph(apiData){
    switch (apiData["report_type"]) {
        case "start_activity":
            return <>
                <Line data={ParseGraphData(apiData)} options={ParseGraphOptions(apiData)} />
            </>
        case "create_account":
            return <>
                <Bar data={ParseGraphData(apiData)} options={ParseGraphOptions(apiData)} />
            </>
    }
};

export function GetDateRange(formData){

    let endDate = formatDate(new Date());
    let initialDate = endDate;
    
   switch (formData.reportOption) {
    case "option1":
      initialDate = SubtractMonthsFromDate(1);
      break;
    
    case "option2":
      initialDate = SubtractMonthsFromDate(3);
      break;
  
    case "option3":
      initialDate = SubtractMonthsFromDate(6);
      break;
  
    case "option4":
      initialDate = SubtractMonthsFromDate(12);
      break;
  
    case "option5":
      endDate = formData.endDate;
      initialDate = formData.startDate;
      break;
   }
   
    return{
      "initialDate" : initialDate,
      "endDate" : endDate
    }
};
  
function SubtractMonthsFromDate(monthsToSubtract) {
    const newDate = new Date();
    newDate.setMonth(newDate.getMonth() - monthsToSubtract);
    return formatDate(newDate);
}
  
function formatDate(date) {
    const year = date.getFullYear().toString();
    const month = (date.getMonth() + 1).toString().padStart(2, '0');
    const day = date.getDate().toString().padStart(2, '0');
    return `${year}-${month}-${day}`;
}

function RemoveDuplicates(arr) { 
    return [...new Set(arr)]; 
} 