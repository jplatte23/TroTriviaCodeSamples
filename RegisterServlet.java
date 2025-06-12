import java.io.FileReader;
import java.io.FileWriter;
import java.io.IOException;
import org.json.simple.JSONArray;
import org.json.simple.JSONObject;
import org.json.simple.parser.JSONParser;

public class RegisterServlet {

	public static int registerUser (String username, String password){
		try {
            JSONParser parser = new JSONParser();
            Object obj = parser.parse(new FileReader("user_data.json"));
            JSONObject jsonObject = (JSONObject) obj;
            JSONArray users = (JSONArray) jsonObject.get("users");

			boolean isRegistered = false;

            // Iterate through the user data
            for (int i = 0; i < users.size(); i++) {
                JSONObject user = (JSONObject) users.get(i);
                String userUsername = (String) user.get("username");
                String userPassword = (String) user.get("password");
                if (userUsername.equals(username) && userPassword.equals(password)) {
                    userID = user.get("userID");
                }
            }
        } catch (Exception e) {
            System.err.println("Error: " + e.getMessage());
            return "false"; // Return false if an error occurs
        }
    
	return userID;


    }

}
