// ===============================
// LTO QUEUE MANAGEMENT SYSTEM
// script.js
// ===============================

// Queue Prefixes
const queueNames = {
    SP: "Student Permit",
    NP: "Non Professional License",
    PR: "Professional License",
    CO: "Conductor License",
    AR: "Additional Restriction",
    DO: "Dormant",
    RN: "Renewal",
    DL: "Duplicate License",
    RR: "Revision of Records",
    FD: "Foreign DL Conversion",
    EN: "Enhancement",
    CR: "Duplicate CR",
    DP: "Duplicate Plate",
    CC: "Change Color",
    CE: "Change Engine",
    TO: "Transfer Ownership",
    PB: "Private to For Hire",
    BD: "Change Body Design",
    CF: "Confirmation"
};

// Generate Queue
function generateQueue(){

    const category = document.getElementById("category").value;
    const priority = document.getElementById("priority").value;

    let number = localStorage.getItem(category);

    if(number == null){
        number = 1;
    }else{
        number = parseInt(number) + 1;
    }

    localStorage.setItem(category, number);

    const queue =
        category + "-" + String(number).padStart(3,"0");

    document.getElementById("queue").innerHTML = queue;

    document.getElementById("date").innerHTML =
        new Date().toLocaleString();

    document.getElementById("ticket").style.display = "block";

    // Save Queue List
    let waiting =
        JSON.parse(localStorage.getItem("waiting")) || [];

    waiting.push({
        number: queue,
        category: queueNames[category],
        priority: priority,
        time: new Date().toLocaleString(),
        status:"Waiting"
    });

    localStorage.setItem(
        "waiting",
        JSON.stringify(waiting)
    );

    alert("Queue Generated Successfully!");
}

// Live Clock
function liveClock(){

    let clock=document.getElementById("clock");

    if(clock){

        setInterval(function(){

            clock.innerHTML =
                new Date().toLocaleString();

        },1000);

    }

}

liveClock();

// Queue Statistics
function loadStatistics(){

    let waiting =
        JSON.parse(localStorage.getItem("waiting")) || [];

    let completed =
        JSON.parse(localStorage.getItem("completed")) || [];

    if(document.getElementById("waitingCount"))
        document.getElementById("waitingCount").innerHTML =
            waiting.length;

    if(document.getElementById("completedCount"))
        document.getElementById("completedCount").innerHTML =
            completed.length;

}

loadStatistics();

// Search Queue
function searchQueue(){

    let search =
        document.getElementById("search").value.toUpperCase();

    let waiting =
        JSON.parse(localStorage.getItem("waiting")) || [];

    let found =
        waiting.find(q=>q.number===search);

    if(found){

        alert(
            found.number+
            "\n"+found.category+
            "\nStatus: "+found.status
        );

    }else{

        alert("Queue Not Found");

    }

}

// Print Ticket
function printTicket(){

    window.print();

}

// Reset Queue
function resetAll(){

    if(confirm("Reset all queues?")){

        localStorage.clear();

        location.reload();

    }

}