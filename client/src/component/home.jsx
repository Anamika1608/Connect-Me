import { useState, useEffect } from 'react'

import { Video, UserPlus, ChevronRight } from 'lucide-react';

function Home() {
  const [meetingCode, setMeetingCode] = useState('');
  
  const handleJoinMeeting = () => {
    if (meetingCode) {
      console.log(window.location.href);
      window.location.href = `/meeting?ID=${meetingCode}`;
    }
  }

  const hanleNewMeeting = () => {
    const meetingCode = Math.floor(100000 + Math.random() * 900000).toString();
    console.log(meetingCode)
    window.location.href = `/meeting?ID=${meetingCode}`;
  }

  return (
    <>
      <div className="min-h-screen bg-gray-900 flex flex-col">

        <div className="flex-1 container mx-auto px-4 py-12 flex flex-col md:flex-row items-center justify-center gap-12">
          <div className="w-full md:w-1/2 max-w-md">
            <div className="bg-gray-800 p-8 rounded-xl shadow-lg">
              <h2 className="text-2xl font-bold text-white mb-6">Join a Meeting</h2>

              <div className="space-y-6">
                <div>
                  <label className="block text-gray-300 mb-2">Meeting Code</label>
                  <input
                    type="text"
                    placeholder="Enter meeting code"
                    value={meetingCode}
                    onChange={(e) => setMeetingCode(e.target.value)}
                    className="w-full px-4 py-2 bg-gray-700 text-white rounded-lg focus:ring-2 focus:ring-blue-500 focus:outline-none"
                  />
                </div>

                <button onClick={handleJoinMeeting}
                  className="w-full bg-blue-500 hover:bg-blue-600 text-white py-2 rounded-lg flex items-center justify-center space-x-2">
                  <span>Join Meeting</span>
                  <ChevronRight className="w-5 h-5" />
                </button>
              </div>
            </div>
          </div>

          <div className="w-full md:w-1/2 max-w-md">
            <div className="bg-gray-800 p-8 rounded-xl shadow-lg">
              <h2 className="text-2xl font-bold text-white mb-6">Create a Meeting</h2>

              <div className="space-y-6">
                <button onClick={hanleNewMeeting}
                  className="w-full bg-green-500 hover:bg-green-600 text-white py-3 rounded-lg flex items-center justify-center space-x-2">
                  <Video className="w-5 h-5" />
                  <span>Start New Meeting</span>
                </button>

                <div className="text-center">
                  <span className="text-gray-400">or</span>
                </div>

                <button className="w-full bg-gray-700 hover:bg-gray-600 text-white py-3 rounded-lg flex items-center justify-center space-x-2">
                  <UserPlus className="w-5 h-5" />
                  <span>Schedule a Meeting</span>
                </button>
              </div>
            </div>
          </div>
        </div>


      </div>
    </>
  )
}

export default Home
