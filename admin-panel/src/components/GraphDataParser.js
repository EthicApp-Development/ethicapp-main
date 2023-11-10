import { Line, Bar } from 'react-chartjs-2';
function ParseGraphData(apiData){

    let graphDataTemp={}

    if (apiData["report_type"] === "start_activity" || apiData["report_type"] === "top_professors") {
        graphDataTemp = {
            labels: apiData["report_x_data"],
            datasets: [
              {
                label: 'Activities Started',
                data: apiData["report_y1_data"],
                backgroundColor: 'rgba(0,102,204)',
              },
            ],
          };
    }else{
        graphDataTemp = {
            labels: RemoveDuplicates(apiData["report_x_data"]),
            datasets: [
                {
                label: 'Students',
                data: apiData["report_y1_data"],
                backgroundColor: 'rgba(0,102,204)',
                },
                {
                label: 'Professors',
                data: apiData["report_y2_data"],
                backgroundColor: 'rgba(255,51,51)',
                },
            ],
            };
    }
    
    return graphDataTemp
};

function ParseGraphOptions(apiData){
    let options={}

    if (apiData["report_type"] === "start_activity" || apiData["report_type"] === "top_professors") {
      let auxXLabel= "Activity Date";
      if (apiData["report_type"] === "top_professors") {
        auxXLabel= "Professor Name"
      }
      options = {
          scales: {
            y: {
              beginAtZero: true,
              display: true,
              title: {
                display: true,
                text: 'Started Activities'
              }
            },
            x: {
              display: true,
              title: {
                display: true,
                text: auxXLabel
              }
            },
          },
          responsive: true,
          maintainAspectRatio: false,
          pointStyle: 'rectRot',
          plugins: {
            title: {
              display: true,
              text: apiData["report_title"]
            },
            legend: {
              labels: {
                usePointStyle: true,
              },
            },
            subtitle: {
              display: true,
              text: `Creation Date : ${apiData["creation_date"]}`
            }
          },
        };
    }else{
      let auxYLabel= "EthicApp Logins";
      if (apiData["report_type"] === "create_account") {
        auxYLabel= "Accounts Created"
      }
      options = {
          scales: {
            x: { 
              stacked: true,
              display: true,
              title: {
                display: true,
                text: "Event Date"
              }
            },
            y: { 
              stacked: true,
              display: true,
              title: {
                display: true,
                text: auxYLabel
              }
            },
          },
          responsive: true,
          maintainAspectRatio: false,
          plugins: {
            title: {
              display: true,
              text: apiData["report_title"]
            },
            subtitle: {
              display: true,
              text: `Creation Date : ${apiData["creation_date"]}`
            }
          },
      };
    }

    return options
};

export function CreateGraph(apiData){
    if (apiData["report_type"] === "start_activity") {
        return <>
            <Line data={ParseGraphData(apiData)} options={ParseGraphOptions(apiData)} />
        </>
    }

    return <>
        <Bar data={ParseGraphData(apiData)} options={ParseGraphOptions(apiData)} />
    </>
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
      
    default:
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